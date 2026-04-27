from __future__ import annotations

import math
import os
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from flask import Flask, jsonify, request
from flask_cors import CORS


app = Flask(__name__)
CORS(app)

SCHEDULING_STEP_MINUTES = 15
MINIMUM_WORK_BLOCK_MINUTES = 60
PRIORITY_RANK = {"high": 0, "medium": 1, "low": 2}
STATUS_RANK = {"in_progress": 0, "new": 1, "completed": 2}
COGNITIVE_LOAD_CAP_MINUTES = {
    "high": 90,
    "medium": 120,
    "low": 180,
}
SAME_TASK_RECOVERY_MINUTES = {
    "high": 180,
    "medium": 90,
    "low": 0,
}
DIFFERENT_TASK_RECOVERY_MINUTES = {
    "high": 120,
    "medium": 0,
    "low": 0,
}


@dataclass(frozen=True)
class TimeBlock:
    start: datetime
    end: datetime

    @property
    def duration_minutes(self) -> int:
        return max(0, int((self.end - self.start).total_seconds() // 60))


@dataclass(frozen=True)
class Segment:
    task_id: str
    title: str
    cognitive_load: str
    start: datetime
    end: datetime
    block_start: datetime
    block_end: datetime

    @property
    def allocated_minutes(self) -> int:
        return max(0, int((self.end - self.start).total_seconds() // 60))


@dataclass(frozen=True)
class Task:
    id: str
    title: str
    estimate_minutes: int
    due_date: date
    priority: str
    cognitive_load: str
    status: str

    @property
    def priority_rank(self) -> int:
        return PRIORITY_RANK.get(self.priority, PRIORITY_RANK["medium"])

    @property
    def status_rank(self) -> int:
        return STATUS_RANK.get(self.status, STATUS_RANK["new"])

    @property
    def cognitive_cap_minutes(self) -> int:
        return COGNITIVE_LOAD_CAP_MINUTES.get(
            self.cognitive_load,
            COGNITIVE_LOAD_CAP_MINUTES["medium"],
        )

    def due_cutoff_for(self, reference: datetime) -> datetime:
        if reference.tzinfo is not None:
            return datetime.combine(self.due_date, time.min, tzinfo=reference.tzinfo) + timedelta(minutes=1)
        return datetime.combine(self.due_date, time.min) + timedelta(minutes=1)

    def sort_score(self, today: date) -> tuple:
        days_until_due = (self.due_date - today).days
        if days_until_due < 4:
            return (
                0,
                self.due_date,
                self.priority_rank,
                self.status_rank,
                self.estimate_minutes,
                self.title.lower(),
            )

        return (
            1,
            self.priority_rank,
            self.due_date,
            self.status_rank,
            self.estimate_minutes,
            self.title.lower(),
        )


def parse_time_block(raw_block: dict) -> TimeBlock:
    start = datetime.fromisoformat(raw_block["start"])
    end = datetime.fromisoformat(raw_block["end"])
    return TimeBlock(start=start, end=end)


def parse_task(raw_task: dict) -> Task:
    return Task(
        id=str(raw_task["id"]),
        title=raw_task["title"].strip(),
        estimate_minutes=int(raw_task["estimateMinutes"]),
        due_date=date.fromisoformat(raw_task["dueDate"]),
        priority=raw_task.get("priority", "medium"),
        cognitive_load=raw_task.get("cognitiveLoad", "medium"),
        status=raw_task.get("status", "new"),
    )


def is_step_aligned(moment: datetime) -> bool:
    return moment.second == 0 and moment.microsecond == 0 and moment.minute % SCHEDULING_STEP_MINUTES == 0


def can_partition_minutes(total_minutes: int, cap_minutes: int) -> bool:
    if total_minutes == 0:
        return True
    if total_minutes < MINIMUM_WORK_BLOCK_MINUTES:
        return False
    if total_minutes % SCHEDULING_STEP_MINUTES != 0:
        return False

    min_segments = max(1, math.ceil(total_minutes / cap_minutes))
    max_segments = total_minutes // MINIMUM_WORK_BLOCK_MINUTES
    return min_segments <= max_segments


def subtract_segments_from_blocks(
    time_blocks: list[TimeBlock],
    segments: list[Segment],
) -> list[TimeBlock]:
    ordered_segments = sorted(segments, key=lambda segment: (segment.start, segment.end))
    free_blocks: list[TimeBlock] = []

    for block in sorted(time_blocks, key=lambda item: item.start):
        parts = [block]
        for segment in ordered_segments:
            next_parts: list[TimeBlock] = []
            for part in parts:
                if segment.end <= part.start or segment.start >= part.end:
                    next_parts.append(part)
                    continue
                if segment.start > part.start:
                    next_parts.append(TimeBlock(start=part.start, end=segment.start))
                if segment.end < part.end:
                    next_parts.append(TimeBlock(start=segment.end, end=part.end))
            parts = next_parts

        free_blocks.extend(part for part in parts if part.duration_minutes >= MINIMUM_WORK_BLOCK_MINUTES)

    return sorted(free_blocks, key=lambda block: block.start)


def build_segment_length_candidates(remaining_minutes: int, cap_minutes: int) -> list[int]:
    if remaining_minutes < MINIMUM_WORK_BLOCK_MINUTES:
        return []

    minimum_segments = max(1, math.ceil(remaining_minutes / cap_minutes))
    target_minutes = remaining_minutes / minimum_segments
    candidates = []

    for length in range(cap_minutes, MINIMUM_WORK_BLOCK_MINUTES - 1, -SCHEDULING_STEP_MINUTES):
        next_remaining = remaining_minutes - length
        if next_remaining < 0:
            continue
        if next_remaining and not can_partition_minutes(next_remaining, cap_minutes):
            continue
        candidates.append(length)

    return sorted(
        candidates,
        key=lambda length: (abs(length - target_minutes), -length),
    )


def recovery_gap_minutes(task: Task, other_segment: Segment) -> int:
    if task.cognitive_load != other_segment.cognitive_load:
        return 0
    if task.cognitive_load == "high":
        if task.id == other_segment.task_id:
            return SAME_TASK_RECOVERY_MINUTES["high"]
        return DIFFERENT_TASK_RECOVERY_MINUTES["high"]
    if task.cognitive_load == "medium" and task.id == other_segment.task_id:
        return SAME_TASK_RECOVERY_MINUTES["medium"]
    return 0


def violates_recovery_gap(task: Task, start: datetime, end: datetime, segments: list[Segment]) -> bool:
    for other in segments:
        required_gap = recovery_gap_minutes(task, other)
        if required_gap == 0:
            continue

        gap = timedelta(minutes=required_gap)
        if end <= other.start:
            if other.start - end < gap:
                return True
            continue
        if start >= other.end:
            if start - other.end < gap:
                return True
            continue
        return True

    return False


def to_segment_dict(segment: Segment) -> dict:
    return {
        "blockStart": segment.block_start.isoformat(),
        "blockEnd": segment.block_end.isoformat(),
        "start": segment.start.isoformat(),
        "end": segment.end.isoformat(),
        "allocatedMinutes": segment.allocated_minutes,
    }


def schedule_single_task(
    task: Task,
    time_blocks: list[TimeBlock],
    committed_segments: list[Segment],
) -> list[Segment]:
    if not time_blocks:
        return []

    due_cutoff = task.due_cutoff_for(time_blocks[0].start)
    eligible_blocks = []
    for block in time_blocks:
        if block.start >= due_cutoff:
            continue
        eligible_blocks.append(
            TimeBlock(
                start=block.start,
                end=min(block.end, due_cutoff),
            )
        )

    eligible_blocks = [block for block in eligible_blocks if block.duration_minutes >= MINIMUM_WORK_BLOCK_MINUTES]
    if not eligible_blocks or not can_partition_minutes(task.estimate_minutes, task.cognitive_cap_minutes):
        return []

    def search(remaining_minutes: int, chosen_segments: list[Segment]) -> list[Segment] | None:
        if remaining_minutes == 0:
            return chosen_segments

        cap_minutes = task.cognitive_cap_minutes
        free_blocks = subtract_segments_from_blocks(eligible_blocks, committed_segments + chosen_segments)
        length_candidates = build_segment_length_candidates(remaining_minutes, cap_minutes)

        for free_block in free_blocks:
            for length in length_candidates:
                if free_block.duration_minutes < length:
                    continue

                latest_start = free_block.end - timedelta(minutes=length)
                start = free_block.start
                while start <= latest_start:
                    end = start + timedelta(minutes=length)
                    if end > due_cutoff:
                        break
                    if violates_recovery_gap(task, start, end, committed_segments + chosen_segments):
                        start += timedelta(minutes=SCHEDULING_STEP_MINUTES)
                        continue

                    segment = Segment(
                        task_id=task.id,
                        title=task.title,
                        cognitive_load=task.cognitive_load,
                        start=start,
                        end=end,
                        block_start=free_block.start,
                        block_end=free_block.end,
                    )
                    result = search(remaining_minutes - length, chosen_segments + [segment])
                    if result is not None:
                        return result
                    start += timedelta(minutes=SCHEDULING_STEP_MINUTES)

        return None

    return search(task.estimate_minutes, []) or []


def build_task_payload(task: Task, segments: list[Segment]) -> dict:
    allocated_minutes = sum(segment.allocated_minutes for segment in segments)
    missing_minutes = max(0, task.estimate_minutes - allocated_minutes)
    payload = {
        "id": task.id,
        "title": task.title,
        "estimateMinutes": task.estimate_minutes,
        "dueDate": task.due_date.isoformat(),
        "priority": task.priority,
        "cognitiveLoad": task.cognitive_load,
        "status": task.status,
        "completionStatus": "complete" if missing_minutes == 0 else "incomplete",
        "segments": [to_segment_dict(segment) for segment in segments],
    }
    if missing_minutes:
        payload["missingMinutes"] = missing_minutes
    return payload


def schedule_tasks(time_blocks: list[TimeBlock], tasks: list[Task], *, now: datetime | None = None) -> dict:
    reference_now = now or datetime.now()
    ordered_blocks = sorted(time_blocks, key=lambda block: block.start)
    ordered_tasks = sorted(tasks, key=lambda task: task.sort_score(reference_now.date()))

    schedule = []
    unscheduled = []
    committed_segments: list[Segment] = []

    for task in ordered_tasks:
        task_segments = schedule_single_task(task, ordered_blocks, committed_segments)
        if task_segments:
            committed_segments.extend(task_segments)
            schedule.append(build_task_payload(task, task_segments))
            continue

        unscheduled.append(
            {
                "id": task.id,
                "title": task.title,
                "estimateMinutes": task.estimate_minutes,
                "dueDate": task.due_date.isoformat(),
                "priority": task.priority,
                "cognitiveLoad": task.cognitive_load,
                "status": task.status,
                "completionStatus": "incomplete",
                "missingMinutes": task.estimate_minutes,
            }
        )

    incomplete_scheduled_count = sum(1 for item in schedule if item["completionStatus"] == "incomplete")
    complete_scheduled_count = len(schedule) - incomplete_scheduled_count

    return {
        "summary": {
            "timeBlockCount": len(ordered_blocks),
            "taskCount": len(tasks),
            "scheduledCount": len(schedule),
            "completeCount": complete_scheduled_count,
            "incompleteCount": incomplete_scheduled_count + len(unscheduled),
            "unscheduledCount": len(unscheduled),
            "totalAvailableMinutes": sum(block.duration_minutes for block in ordered_blocks),
            "totalPlannedMinutes": sum(task.estimate_minutes for task in tasks),
        },
        "schedule": schedule,
        "unscheduled": unscheduled,
    }


@app.get("/health")
def health_check():
    return jsonify({"status": "ok"})


@app.post("/api/schedule")
def create_schedule():
    payload = request.get_json(force=True, silent=False)
    time_blocks = [parse_time_block(item) for item in payload.get("timeBlocks", [])]
    tasks = [parse_task(item) for item in payload.get("tasks", [])]
    app.logger.info(
        "schedule request received: %s blocks, %s tasks",
        len(time_blocks),
        len(tasks),
    )

    if not time_blocks:
        return jsonify({"error": "At least one time block is required."}), 400
    if not tasks:
        return jsonify({"error": "At least one task is required."}), 400
    if any(block.end <= block.start for block in time_blocks):
        return jsonify({"error": "Each time block must end after it starts."}), 400
    if any(task.estimate_minutes <= 0 for task in tasks):
        return jsonify({"error": "Each task estimate must be greater than zero."}), 400
    if any(not is_step_aligned(block.start) or not is_step_aligned(block.end) for block in time_blocks):
        return jsonify({"error": "Time blocks must align to 15-minute boundaries."}), 400

    result = schedule_tasks(time_blocks, tasks)
    app.logger.info(
        "schedule result: %s scheduled, %s unscheduled",
        len(result["schedule"]),
        len(result["unscheduled"]),
    )
    return jsonify(result)


if __name__ == "__main__":
    port = int(os.environ.get("FLASK_PORT", "5050"))
    app.run(host="127.0.0.1", port=port)
