from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta, date

from flask import Flask, jsonify, request
from flask_cors import CORS


app = Flask(__name__)
CORS(app)
MINIMUM_WORK_BLOCK_MINUTES = 60

@dataclass
class TimeBlock:
    start: datetime
    end: datetime

    @property
    def duration_minutes(self) -> int:
        return max(0, int((self.end - self.start).total_seconds() // 60))


@dataclass
class Task:
    id: str
    title: str
    estimate_minutes: int
    due_date: date
    priority: str
    cognitive_load: str

    @property
    def sort_score(self) -> tuple[date, int, str]:
        return (
            self.due_date,
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
    )


def schedule_tasks(time_blocks: list[TimeBlock], tasks: list[Task]) -> dict:
    ordered_blocks = sorted(time_blocks, key=lambda block: block.start)
    ordered_tasks = sorted(tasks, key=lambda task: task.sort_score)

    scheduled = []
    unscheduled = []

    for task in ordered_tasks:
        remaining = task.estimate_minutes
        segments = []
        minimum_allocation = min(MINIMUM_WORK_BLOCK_MINUTES, task.estimate_minutes)

        for block in ordered_blocks:
            if remaining <= 0:
                break

            used_in_block = sum(
                segment["allocatedMinutes"]
                for scheduled_task in scheduled
                for segment in scheduled_task["segments"]
                if segment["blockStart"] == block.start.isoformat()
            )
            available = block.duration_minutes - used_in_block

            if available < minimum_allocation:
                continue

            allocation = min(available, remaining)
            if allocation < minimum_allocation:
                continue
            segment_start = block.start + timedelta(minutes=used_in_block)
            segment_end = segment_start + timedelta(minutes=allocation)

            segments.append(
                {
                    "blockStart": block.start.isoformat(),
                    "blockEnd": block.end.isoformat(),
                    "start": segment_start.isoformat(),
                    "end": segment_end.isoformat(),
                    "allocatedMinutes": allocation,
                }
            )
            remaining -= allocation

        if remaining == 0:
            scheduled.append(
                {
                    "id": task.id,
                    "title": task.title,
                    "estimateMinutes": task.estimate_minutes,
                    "dueDate": task.due_date.isoformat(),
                    "priority": task.priority,
                    "cognitiveLoad": task.cognitive_load,
                    "segments": segments,
                }
            )
        elif segments:
            scheduled.append(
                {
                    "id": task.id,
                    "title": task.title,
                    "estimateMinutes": task.estimate_minutes,
                    "dueDate": task.due_date.isoformat(),
                    "priority": task.priority,
                    "cognitiveLoad": task.cognitive_load,
                    "missingMinutes": remaining,
                    "segments": segments,
                }
            )
        else:
            unscheduled.append(
                {
                    "id": task.id,
                    "title": task.title,
                    "estimateMinutes": task.estimate_minutes,
                    "dueDate": task.due_date.isoformat(),
                    "priority": task.priority,
                    "cognitiveLoad": task.cognitive_load,
                    "missingMinutes": remaining,
                }
            )

    return {
        "summary": {
            "timeBlockCount": len(ordered_blocks),
            "taskCount": len(tasks),
            "scheduledCount": len(scheduled),
            "unscheduledCount": len(unscheduled),
            "totalAvailableMinutes": sum(block.duration_minutes for block in ordered_blocks),
            "totalPlannedMinutes": sum(task.estimate_minutes for task in tasks),
        },
        "schedule": scheduled,
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
