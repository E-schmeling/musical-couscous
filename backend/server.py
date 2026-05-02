from __future__ import annotations

import logging
import math
import os
import time as clock
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from flask import Flask, jsonify, request
from flask_cors import CORS
from ortools.sat.python import cp_model

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = Flask(__name__)
CORS(app)
app.logger.setLevel(logging.INFO)

# ---------------------------------------------------------------------------
# Scheduling constants
# ---------------------------------------------------------------------------

SCHEDULING_STEP_MINUTES = 15
"""Minimum granularity for all schedule placements and block boundaries."""

MINIMUM_WORK_BLOCK_MINUTES = 60
"""Shortest continuous work segment that can be placed for any task."""

PRIORITY_RANK = {"high": 0, "medium": 1, "low": 2}
"""Lower rank = higher scheduling priority."""

STATUS_RANK = {"in_progress": 0, "new": 1, "completed": 2}
"""Lower rank = higher scheduling preference; in-progress tasks are preferred."""

COGNITIVE_LOAD_CAP_MINUTES = {
    "high": 90,
    "medium": 120,
    "low": 180,
}
"""Maximum continuous work minutes allowed per segment, keyed by cognitive load level."""

SAME_TASK_RECOVERY_MINUTES = {
    "high": 180,
    "medium": 90,
    "low": 0,
}
"""Required recovery gap in minutes before the same task can be scheduled again."""

DIFFERENT_TASK_RECOVERY_MINUTES = {
    "high": 120,
    "medium": 0,
    "low": 0,
}
"""Required recovery gap in minutes between two different high-load tasks."""

EMERGENCY_OVERLOAD_DUE_DAYS = 2
"""Tasks due within this many days may exceed their cognitive load cap as a last resort."""

REPACK_WINDOW_MINUTES = 210
"""Window size used when repacking segments within a day to create space for new tasks."""

MAX_FULL_VARIANT_TASKS = 10
"""Maximum tasks before the solver reduces variant exploration to stay within time limits."""

MAX_CANDIDATE_SEGMENTS_PER_TASK = 160
"""Default maximum number of segment placement candidates generated per task."""

MAX_CANDIDATE_LENGTHS_PER_TASK = 8
"""Default maximum number of distinct segment lengths considered per task."""

SOLVER_TIME_LIMIT_SECONDS = 5.0
"""Hard time limit for the CP-SAT solver before it returns the best solution found so far."""


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class TimeBlock:
    """A contiguous window of available time that tasks can be scheduled into.

    Attributes:
        start: The start of the available window (timezone-aware or naive).
        end: The end of the available window (timezone-aware or naive).
    """

    start: datetime
    end: datetime

    @property
    def duration_minutes(self) -> int:
        """Total length of this block in whole minutes."""
        return max(0, int((self.end - self.start).total_seconds() // 60))


@dataclass(frozen=True)
class Segment:
    """A single scheduled work block assigned to a task within a time block.

    Attributes:
        task_id: Identifier of the task this segment belongs to.
        title: Display name of the task.
        cognitive_load: Cognitive load level of the task ('high', 'medium', 'low').
        start: Scheduled start time of this segment.
        end: Scheduled end time of this segment.
        block_start: Start of the parent availability block this segment lives in.
        block_end: End of the parent availability block this segment lives in.
    """

    task_id: str
    title: str
    cognitive_load: str
    start: datetime
    end: datetime
    block_start: datetime
    block_end: datetime

    @property
    def allocated_minutes(self) -> int:
        """Duration of this segment in whole minutes."""
        return max(0, int((self.end - self.start).total_seconds() // 60))


@dataclass(frozen=True)
class SegmentCandidate:
    """A candidate segment placement considered during CP-SAT model construction.

    Attributes:
        task: The task this candidate belongs to.
        segment: The proposed segment placement.
        used_emergency_overload: True if this placement exceeds the cognitive load cap.
    """

    task: "Task"
    segment: Segment
    used_emergency_overload: bool


@dataclass(frozen=True)
class SolverProfile:
    """Tuning parameters that scale CP-SAT candidate generation based on problem size.

    Larger problems use tighter limits to keep model construction and solve time
    within acceptable bounds.

    Attributes:
        max_candidate_segments_per_task: Maximum segment candidates per task fed to the model.
        max_candidate_lengths_per_task: Maximum distinct segment durations per task.
        max_candidate_starts_per_block: Maximum start positions sampled per availability block.
    """

    max_candidate_segments_per_task: int
    max_candidate_lengths_per_task: int
    max_candidate_starts_per_block: int


@dataclass(frozen=True)
class Task:
    """A schedulable unit of work with timing, priority, and cognitive load constraints.

    Attributes:
        id: Unique identifier for this task.
        title: Human-readable name.
        estimate_minutes: Total work time required, in minutes.
        due_date: Deadline; all segments must be placed before this date.
        priority: Scheduling priority ('high', 'medium', 'low').
        cognitive_load: Effort intensity level ('high', 'medium', 'low').
        status: Current task status ('new', 'in_progress', 'completed').
    """

    id: str
    title: str
    estimate_minutes: int
    due_date: date
    priority: str
    cognitive_load: str
    status: str

    @property
    def priority_rank(self) -> int:
        """Numeric rank for priority; lower = higher priority."""
        return PRIORITY_RANK.get(self.priority, PRIORITY_RANK["medium"])

    @property
    def status_rank(self) -> int:
        """Numeric rank for status; lower = more preferred."""
        return STATUS_RANK.get(self.status, STATUS_RANK["new"])

    @property
    def cognitive_cap_minutes(self) -> int:
        """Maximum continuous work minutes allowed per segment for this task."""
        return COGNITIVE_LOAD_CAP_MINUTES.get(
            self.cognitive_load,
            COGNITIVE_LOAD_CAP_MINUTES["medium"],
        )

    def due_cutoff_for(self, reference: datetime) -> datetime:
        """Return the hard scheduling deadline as a datetime (start of due date + 1 minute).

        Args:
            reference: A datetime used to determine timezone context.

        Returns:
            A datetime representing the earliest moment on the due date,
            used as a strict upper bound when clipping availability blocks.
        """
        if reference.tzinfo is not None:
            return datetime.combine(self.due_date, time.min, tzinfo=reference.tzinfo) + timedelta(minutes=1)
        return datetime.combine(self.due_date, time.min) + timedelta(minutes=1)

    def sort_score(self, today: date) -> tuple:
        """Return a sort key that controls scheduling priority order.

        Tasks due within 4 days are sorted primarily by urgency (days until due),
        then by priority. Tasks due further out are sorted by priority first.

        Args:
            today: The current date used to calculate days until due.

        Returns:
            A tuple suitable for use as a sort key.
        """
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

    def can_use_emergency_overload(self, today: date) -> bool:
        """Return True if this task is close enough to its deadline to use overload scheduling.

        Emergency overload allows segments to exceed the cognitive load cap when
        the task would otherwise be unschedulable before its deadline.

        Args:
            today: The current date.

        Returns:
            True if the task is due within EMERGENCY_OVERLOAD_DUE_DAYS.
        """
        return (self.due_date - today).days <= EMERGENCY_OVERLOAD_DUE_DAYS

    def emergency_overload_penalty(self, today: date) -> int:
        """Return the objective penalty for using emergency overload on this task.

        Tasks not eligible for overload receive a large penalty to discourage
        the solver from placing them in oversized segments.

        Args:
            today: The current date.

        Returns:
            0 if overload is allowed, otherwise a fixed penalty value.
        """
        if self.can_use_emergency_overload(today):
            return 0
        return 25_000


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def parse_time_block(raw_block: dict) -> TimeBlock:
    """Parse a raw JSON time block dict into a TimeBlock dataclass.

    Args:
        raw_block: A dict with 'start' and 'end' ISO 8601 string fields.

    Returns:
        A TimeBlock with parsed datetime values.
    """
    start = datetime.fromisoformat(raw_block["start"])
    end = datetime.fromisoformat(raw_block["end"])
    return TimeBlock(start=start, end=end)


def parse_task(raw_task: dict) -> Task:
    """Parse a raw JSON task dict into a Task dataclass.

    Missing optional fields ('priority', 'cognitiveLoad', 'status') default to
    'medium', 'medium', and 'new' respectively.

    Args:
        raw_task: A dict with task fields from the frontend request payload.

    Returns:
        A fully populated Task dataclass.
    """
    return Task(
        id=str(raw_task["id"]),
        title=raw_task["title"].strip(),
        estimate_minutes=int(raw_task["estimateMinutes"]),
        due_date=date.fromisoformat(raw_task["dueDate"]),
        priority=raw_task.get("priority", "medium"),
        cognitive_load=raw_task.get("cognitiveLoad", "medium"),
        status=raw_task.get("status", "new"),
    )


# ---------------------------------------------------------------------------
# Scheduling utilities
# ---------------------------------------------------------------------------

def is_step_aligned(moment: datetime) -> bool:
    """Return True if the datetime falls exactly on a SCHEDULING_STEP_MINUTES boundary.

    Args:
        moment: The datetime to check.

    Returns:
        True if seconds and microseconds are zero and minutes are divisible
        by SCHEDULING_STEP_MINUTES.
    """
    return moment.second == 0 and moment.microsecond == 0 and moment.minute % SCHEDULING_STEP_MINUTES == 0


def can_partition_minutes(total_minutes: int, cap_minutes: int) -> bool:
    """Return True if total_minutes can be split into valid segments under the cap.

    A valid partition requires that every segment is at least MINIMUM_WORK_BLOCK_MINUTES
    long and no segment exceeds cap_minutes. The total must also be step-aligned.

    Args:
        total_minutes: The total work time to partition.
        cap_minutes: The maximum allowed segment length.

    Returns:
        True if a valid partition exists, False otherwise.
    """
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
    """Remove committed segment times from availability blocks, returning free blocks.

    Segments that overlap a block are carved out, potentially splitting the block
    into two smaller free blocks. Resulting blocks shorter than MINIMUM_WORK_BLOCK_MINUTES
    are discarded.

    Args:
        time_blocks: The full set of available time blocks.
        segments: Already-committed segments to subtract from availability.

    Returns:
        A sorted list of free TimeBlocks with committed time removed.
    """
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
    """Generate valid segment lengths for placing a portion of a task within its cap.

    Candidates are sorted by closeness to the ideal even-split length, with longer
    segments preferred as a tiebreaker to minimize fragmentation.

    Args:
        remaining_minutes: Work time still to be placed.
        cap_minutes: Maximum allowed segment length for this task.

    Returns:
        A sorted list of valid segment lengths in minutes.
    """
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


def build_overload_length_candidates(remaining_minutes: int, cap_minutes: int) -> list[int]:
    """Generate segment lengths that exceed the cognitive cap for emergency overload use.

    These candidates are only used when a task qualifies for emergency overload
    scheduling (i.e., the deadline is within EMERGENCY_OVERLOAD_DUE_DAYS).

    Args:
        remaining_minutes: Work time still to be placed.
        cap_minutes: The normal maximum segment length (overload candidates exceed this).

    Returns:
        A list of overload-length candidates, or an empty list if not applicable.
    """
    if remaining_minutes < MINIMUM_WORK_BLOCK_MINUTES or remaining_minutes % SCHEDULING_STEP_MINUTES != 0:
        return []

    candidates = []
    for length in range(remaining_minutes, cap_minutes - 1, -SCHEDULING_STEP_MINUTES):
        if length < MINIMUM_WORK_BLOCK_MINUTES:
            continue
        next_remaining = remaining_minutes - length
        if next_remaining and not can_partition_minutes(next_remaining, cap_minutes):
            continue
        candidates.append(length)
    return candidates


def recovery_gap_minutes(task: Task, other_segment: Segment) -> int:
    """Return the required recovery gap in minutes between a task and an existing segment.

    Recovery gaps apply when the task and segment share the same cognitive load level.
    High-load tasks require gaps both between same-task repetitions and between
    different high-load tasks.

    Args:
        task: The task being evaluated for placement.
        other_segment: A segment already committed to the schedule.

    Returns:
        The minimum required gap in minutes, or 0 if no gap is needed.
    """
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
    """Return True if placing a task at [start, end) would violate any recovery gap constraint.

    Checks each committed segment to ensure the proposed placement respects
    the required rest period before and after each relevant segment.

    Args:
        task: The task being placed.
        start: Proposed segment start time.
        end: Proposed segment end time.
        segments: Already-committed segments to check against.

    Returns:
        True if any recovery gap would be violated, False if the placement is clean.
    """
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
    """Serialize a Segment dataclass to a JSON-compatible dict for API responses.

    Args:
        segment: The segment to serialize.

    Returns:
        A dict with ISO 8601 string fields for start, end, blockStart, blockEnd,
        and an integer allocatedMinutes field.
    """
    return {
        "blockStart": segment.block_start.isoformat(),
        "blockEnd": segment.block_end.isoformat(),
        "start": segment.start.isoformat(),
        "end": segment.end.isoformat(),
        "allocatedMinutes": segment.allocated_minutes,
    }


def clip_block_to_due(task: Task, block: TimeBlock) -> TimeBlock | None:
    """Clip a time block to end no later than the task's due cutoff.

    If the block starts after the deadline or the clipped result is too short
    to hold a minimum work block, returns None.

    Args:
        task: The task whose deadline is used for clipping.
        block: The availability block to clip.

    Returns:
        A clipped TimeBlock, or None if no usable time remains before the deadline.
    """
    due_cutoff = task.due_cutoff_for(block.start)
    if block.start >= due_cutoff:
        return None
    clipped = TimeBlock(start=block.start, end=min(block.end, due_cutoff))
    if clipped.duration_minutes < MINIMUM_WORK_BLOCK_MINUTES:
        return None
    return clipped


def build_eligible_blocks(task: Task, time_blocks: list[TimeBlock]) -> list[TimeBlock]:
    """Return all time blocks clipped to the task's due deadline.

    Blocks that fall entirely after the deadline or are too short after clipping
    are excluded.

    Args:
        task: The task whose deadline is used to filter and clip blocks.
        time_blocks: The full set of available time blocks.

    Returns:
        A list of TimeBlocks usable for scheduling this task.
    """
    eligible = []
    for block in time_blocks:
        clipped = clip_block_to_due(task, block)
        if clipped is not None:
            eligible.append(clipped)
    return eligible


def build_candidate_lengths(remaining_minutes: int, cap_minutes: int, allow_overload: bool) -> list[int]:
    """Combine overload and standard segment length candidates into one ordered list.

    Overload candidates (if allowed) are listed first, followed by standard
    cap-respecting candidates. Duplicates are removed while preserving order.

    Args:
        remaining_minutes: Work time still to be placed.
        cap_minutes: The cognitive load cap for this task.
        allow_overload: Whether emergency overload lengths should be included.

    Returns:
        A deduplicated list of candidate segment lengths in preferred order.
    """
    candidates: list[int] = []
    if allow_overload:
        for overload_length in build_overload_length_candidates(remaining_minutes, cap_minutes):
            if overload_length not in candidates:
                candidates.append(overload_length)
    for length in build_segment_length_candidates(remaining_minutes, cap_minutes):
        if length not in candidates:
            candidates.append(length)
    return candidates


def build_candidate_lengths_for_variant(
    remaining_minutes: int,
    cap_minutes: int,
    allow_overload: bool,
    *,
    reverse_lengths: bool,
) -> list[int]:
    """Return candidate segment lengths, optionally reversed for variant exploration.

    Used by the greedy scheduler to explore different placement orderings across
    multiple solver variants.

    Args:
        remaining_minutes: Work time still to be placed.
        cap_minutes: The cognitive load cap for this task.
        allow_overload: Whether emergency overload lengths are permitted.
        reverse_lengths: If True, sort lengths ascending instead of the default descending.

    Returns:
        An ordered list of candidate segment lengths.
    """
    candidates = build_candidate_lengths(remaining_minutes, cap_minutes, allow_overload)
    if reverse_lengths:
        return sorted(candidates)
    return candidates


def order_free_blocks(blocks: list[TimeBlock], *, reverse_blocks: bool) -> list[TimeBlock]:
    """Sort free blocks by start time, with optional reversal for variant exploration.

    Args:
        blocks: The list of free time blocks to order.
        reverse_blocks: If True, sort in descending order (latest first).

    Returns:
        A sorted list of TimeBlocks.
    """
    return sorted(blocks, key=lambda block: (block.start, block.end), reverse=reverse_blocks)


def iterate_candidate_starts(
    free_block: TimeBlock,
    length: int,
    *,
    reverse_starts: bool,
) -> list[datetime]:
    """Generate all valid segment start times within a free block for a given length.

    Start times are spaced SCHEDULING_STEP_MINUTES apart. If reverse_starts is True,
    the list is returned in reverse order to explore later placements first.

    Args:
        free_block: The availability window to iterate within.
        length: The segment length in minutes.
        reverse_starts: If True, return start times in descending order.

    Returns:
        A list of candidate start datetimes.
    """
    latest_start = free_block.end - timedelta(minutes=length)
    starts: list[datetime] = []
    cursor = free_block.start
    while cursor <= latest_start:
        starts.append(cursor)
        cursor += timedelta(minutes=SCHEDULING_STEP_MINUTES)
    if reverse_starts:
        starts.reverse()
    return starts


def dedupe_task_orders(task_orders: list[list[Task]]) -> list[list[Task]]:
    """Remove duplicate task orderings from a list of sort variants.

    Two orderings are considered duplicates if they contain the same task IDs
    in the same sequence.

    Args:
        task_orders: A list of task orderings to deduplicate.

    Returns:
        A list with duplicate orderings removed, preserving first-seen order.
    """
    unique_orders: list[list[Task]] = []
    seen: set[tuple[str, ...]] = set()
    for order in task_orders:
        key = tuple(task.id for task in order)
        if key in seen:
            continue
        seen.add(key)
        unique_orders.append(order)
    return unique_orders


def build_task_order_variants(tasks: list[Task], today: date) -> list[list[Task]]:
    """Generate multiple task orderings to explore different greedy scheduling strategies.

    Each variant uses a different primary sort key (urgency, priority, due date,
    or estimate size) to maximize the chance of finding a high-value schedule.
    Duplicate orderings are removed.

    Args:
        tasks: The tasks to sort.
        today: The current date, used by sort_score for urgency calculation.

    Returns:
        A deduplicated list of task orderings.
    """
    return dedupe_task_orders(
        [
            sorted(tasks, key=lambda task: task.sort_score(today)),
            sorted(
                tasks,
                key=lambda task: (
                    task.due_date,
                    task.priority_rank,
                    task.status_rank,
                    task.estimate_minutes,
                    task.title.lower(),
                ),
            ),
            sorted(
                tasks,
                key=lambda task: (
                    task.priority_rank,
                    task.due_date,
                    task.status_rank,
                    task.estimate_minutes,
                    task.title.lower(),
                ),
            ),
            sorted(
                tasks,
                key=lambda task: (
                    task.due_date,
                    task.estimate_minutes,
                    task.priority_rank,
                    task.status_rank,
                    task.title.lower(),
                ),
            ),
        ]
    )


def build_placement_variants() -> list[tuple[bool, bool, bool]]:
    """Return a list of (reverse_blocks, reverse_starts, reverse_lengths) flag combinations.

    Each tuple is a distinct placement variant used by the greedy scheduler to
    explore different segment positioning strategies (e.g., pack early vs. pack late).

    Returns:
        A list of flag tuples for greedy variant exploration.
    """
    return [
        (False, False, False),
        (True, True, False),
        (False, True, False),
        (True, False, False),
        (False, False, True),
        (True, True, True),
    ]


def scheduled_task_value(task: Task, *, today: date) -> int:
    """Compute the objective value for scheduling a task, used by the CP-SAT optimizer.

    Tasks due within 4 days weight urgency heavily. Tasks due further out weight
    priority level more. In-progress tasks receive a bonus to encourage continuity.

    Args:
        task: The task to score.
        today: The current date, used to calculate days until due.

    Returns:
        An integer objective value; higher values are preferred by the solver.
    """
    days_until_due = (task.due_date - today).days
    priority_value = 3 - task.priority_rank
    status_value = 1 if task.status == "in_progress" else 0

    if days_until_due < 4:
        primary_weight = max(0, 30 - max(days_until_due, 0)) * 2_500_000
        secondary_weight = priority_value * 750_000
    else:
        primary_weight = priority_value * 2_000_000
        secondary_weight = max(0, 30 - max(days_until_due, 0)) * 250_000

    return (
        primary_weight
        + secondary_weight
        + status_value * 150_000
        + task.estimate_minutes * 250
        + priority_value * task.estimate_minutes * 100
    )


def result_score(schedule: list[dict], unscheduled: list[dict], all_tasks: list[Task], *, today: date) -> tuple[int, int, int, int, int]:
    """Compute a multi-dimensional quality score for comparing greedy schedule variants.

    The score tuple is ordered so that lexicographic comparison prefers schedules
    with higher total task value, more complete tasks, more scheduled tasks,
    fewer unscheduled tasks, and higher aggregate priority.

    Args:
        schedule: List of scheduled task payload dicts.
        unscheduled: List of unscheduled task payload dicts.
        all_tasks: Full list of Task objects for value lookup.
        today: The current date for value calculation.

    Returns:
        A tuple of (scheduled_value, complete_count, scheduled_count,
        negative_unscheduled_count, scheduled_priority_value).
    """
    task_lookup = {task.id: task for task in all_tasks}
    scheduled_value = sum(
        scheduled_task_value(task_lookup[item["id"]], today=today)
        for item in schedule
        if item["id"] in task_lookup
    )
    scheduled_priority_value = sum(
        3 - task_lookup[item["id"]].priority_rank
        for item in schedule
        if item["id"] in task_lookup
    )
    complete_count = sum(1 for item in schedule if item["completionStatus"] == "complete")
    return (
        scheduled_value,
        complete_count,
        len(schedule),
        -len(unscheduled),
        scheduled_priority_value,
    )


def try_schedule_task_greedily(
    task: Task,
    time_blocks: list[TimeBlock],
    committed_segments: list[Segment],
    *,
    today: date,
    reverse_blocks: bool = False,
    reverse_starts: bool = False,
    reverse_lengths: bool = False,
) -> tuple[list[Segment] | None, bool]:
    """Attempt to place all segments for a task using a greedy left-to-right search.

    Iterates over free blocks and candidate lengths in the specified order,
    placing segments one at a time until the full estimate is covered or
    no more placements are possible.

    Args:
        task: The task to schedule.
        time_blocks: All available time blocks (before subtracting committed segments).
        committed_segments: Segments already placed in the schedule.
        today: The current date, used for overload and sort score checks.
        reverse_blocks: If True, try later blocks first.
        reverse_starts: If True, try later start times within each block first.
        reverse_lengths: If True, try shorter segment lengths first.

    Returns:
        A tuple of (sorted segments list, used_emergency_overload flag) if the task
        was fully scheduled, or (None, False) if placement failed.
    """
    eligible_blocks = build_eligible_blocks(task, time_blocks)
    if not eligible_blocks:
        return None, False

    allow_overload = task.can_use_emergency_overload(today)
    if not allow_overload and not can_partition_minutes(task.estimate_minutes, task.cognitive_cap_minutes):
        return None, False

    chosen_segments: list[Segment] = []
    remaining_minutes = task.estimate_minutes
    used_emergency_overload = False

    while remaining_minutes > 0:
        free_blocks = subtract_segments_from_blocks(eligible_blocks, committed_segments + chosen_segments)
        if not free_blocks:
            break

        next_segment: Segment | None = None
        for free_block in order_free_blocks(free_blocks, reverse_blocks=reverse_blocks):
            length_candidates = build_candidate_lengths_for_variant(
                remaining_minutes,
                task.cognitive_cap_minutes,
                allow_overload,
                reverse_lengths=reverse_lengths,
            )
            for length in length_candidates:
                if free_block.duration_minutes < length:
                    continue

                for start in iterate_candidate_starts(
                    free_block,
                    length,
                    reverse_starts=reverse_starts,
                ):
                    end = start + timedelta(minutes=length)
                    if violates_recovery_gap(task, start, end, committed_segments + chosen_segments):
                        continue

                    next_segment = Segment(
                        task_id=task.id,
                        title=task.title,
                        cognitive_load=task.cognitive_load,
                        start=start,
                        end=end,
                        block_start=free_block.start,
                        block_end=free_block.end,
                    )
                    if length > task.cognitive_cap_minutes:
                        used_emergency_overload = True
                    break

                if next_segment is not None:
                    break

            if next_segment is not None:
                break

        if next_segment is None:
            break

        chosen_segments.append(next_segment)
        remaining_minutes -= next_segment.allocated_minutes

    if not chosen_segments or remaining_minutes > 0:
        return None, False

    return sorted(chosen_segments, key=lambda segment: segment.start), used_emergency_overload


def build_task_payload(task: Task, segments: list[Segment]) -> dict:
    """Build the API response payload for a successfully scheduled task.

    Includes task metadata, all segment details, completion status,
    and missing minutes if the task was only partially scheduled.

    Args:
        task: The scheduled task.
        segments: The placed segments for this task.

    Returns:
        A dict suitable for inclusion in the 'schedule' array of the API response.
    """
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


def build_incomplete_payload(task: Task, reason: dict | None = None) -> dict:
    """Build the API response payload for a task that could not be fully scheduled.

    Optionally includes structured reason information with a machine-readable
    code, a human-readable message, and optional details.

    Args:
        task: The unscheduled task.
        reason: Optional dict with 'code', 'message', and 'details' keys
                describing why scheduling failed.

    Returns:
        A dict suitable for inclusion in the 'unscheduled' array of the API response.
    """
    payload = {
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
    if reason:
        if reason.get("code") is not None:
            payload["unscheduledReasonCode"] = reason["code"]
        if reason.get("message") is not None:
            payload["unscheduledReason"] = reason["message"]
        if reason.get("details") is not None:
            payload["unscheduledDetails"] = reason["details"]
    return payload


def infer_unscheduled_reason(task: Task, time_blocks: list[TimeBlock], *, scheduled_count: int = 0) -> dict:
    if task.estimate_minutes < MINIMUM_WORK_BLOCK_MINUTES:
        return {
            "code": "estimate_below_minimum_block",
            "message": "Task estimate is below the minimum schedulable work block.",
        }

    eligible_blocks = build_eligible_blocks(task, time_blocks)
    if not eligible_blocks:
        return {
            "code": "deadline_conflict",
            "message": "No valid availability remains before the task deadline.",
        }

    if scheduled_count > 0:
        return {
            "code": "higher_value_tasks_preferred",
            "message": "The optimizer chose other tasks with higher scheduling value first.",
        }

    if max((block.duration_minutes for block in eligible_blocks), default=0) < MINIMUM_WORK_BLOCK_MINUTES:
        return {
            "code": "insufficient_contiguous_time",
            "message": "No remaining availability block is long enough to schedule this task.",
        }

    return {
        "code": "insufficient_capacity",
        "message": "Not enough valid time remained to place this task before its deadline.",
    }
    if reason:
        if reason.get("code") is not None:
            payload["unscheduledReasonCode"] = reason["code"]
        if reason.get("message") is not None:
            payload["unscheduledReason"] = reason["message"]
        if reason.get("details") is not None:
            payload["unscheduledDetails"] = reason["details"]
    return payload


def infer_unscheduled_reason(task: Task, time_blocks: list[TimeBlock], *, scheduled_count: int = 0) -> dict:
    """Infer the most likely reason a task could not be scheduled and return a reason dict.

    Checks in order: estimate too small, no blocks before deadline, displaced by
    higher-value tasks, no contiguous block large enough, or general capacity failure.

    Args:
        task: The task that failed to schedule.
        time_blocks: The full set of available blocks used for diagnosis.
        scheduled_count: Number of tasks already scheduled; used to detect
                         displacement by higher-priority tasks.

    Returns:
        A dict with 'code' and 'message' keys describing the failure reason.
    """
    if task.estimate_minutes < MINIMUM_WORK_BLOCK_MINUTES:
        return {
            "code": "estimate_below_minimum_block",
            "message": "Task estimate is below the minimum schedulable work block.",
        }

    eligible_blocks = build_eligible_blocks(task, time_blocks)
    if not eligible_blocks:
        return {
            "code": "deadline_conflict",
            "message": "No valid availability remains before the task deadline.",
        }

    if scheduled_count > 0:
        return {
            "code": "higher_value_tasks_preferred",
            "message": "The optimizer chose other tasks with higher scheduling value first.",
        }

    if max((block.duration_minutes for block in eligible_blocks), default=0) < MINIMUM_WORK_BLOCK_MINUTES:
        return {
            "code": "insufficient_contiguous_time",
            "message": "No remaining availability block is long enough to schedule this task.",
        }

    return {
        "code": "insufficient_capacity",
        "message": "Not enough valid time remained to place this task before its deadline.",
    }


def rebuild_payload(task: Task, segments: list[Segment], *, used_emergency_overload: bool) -> dict:
    """Build a task payload and optionally flag emergency overload usage.

    Args:
        task: The scheduled task.
        segments: The placed segments.
        used_emergency_overload: If True, adds a 'usedEmergencyOverload' flag to the payload.

    Returns:
        A complete task payload dict.
    """
    payload = build_task_payload(task, segments)
    if used_emergency_overload:
        payload["usedEmergencyOverload"] = True
    return payload


def plan_fragmentation_penalty(segments: list[Segment]) -> int:
    """Compute a fragmentation penalty score for a set of segments.

    Higher scores indicate more uneven segment sizes or more segments.
    Used internally to prefer compact, even placements over fragmented ones.

    Args:
        segments: The placed segments for a task.

    Returns:
        An integer penalty; 0 for single-segment tasks.
    """
    if len(segments) <= 1:
        return 0
    lengths = [segment.allocated_minutes for segment in segments]
    return (max(lengths) - min(lengths)) + (len(segments) - 1) * 15


def plan_uses_emergency_overload(task: Task, segments: list[Segment]) -> bool:
    """Return True if any segment exceeds the task's cognitive load cap.

    Args:
        task: The task whose cap is used for comparison.
        segments: The placed segments to inspect.

    Returns:
        True if at least one segment is longer than the cognitive cap.
    """
    return any(segment.allocated_minutes > task.cognitive_cap_minutes for segment in segments)


def build_solver_profile(task_count: int, block_count: int, total_available_minutes: int) -> SolverProfile:
    """Select a SolverProfile based on problem size to keep model construction fast.

    Larger problems receive tighter candidate limits to prevent the CP-SAT model
    from growing too large. Smaller problems use the full candidate budget for
    better solution quality.

    Args:
        task_count: Number of tasks to schedule.
        block_count: Number of available time blocks.
        total_available_minutes: Sum of all block durations in minutes.

    Returns:
        A SolverProfile with appropriate candidate limits for the problem size.
    """
    if task_count >= 32 or block_count >= 36 or total_available_minutes >= 6000:
        return SolverProfile(
            max_candidate_segments_per_task=24,
            max_candidate_lengths_per_task=2,
            max_candidate_starts_per_block=2,
        )
    if task_count >= 20 or block_count >= 28 or total_available_minutes >= 4200:
        return SolverProfile(
            max_candidate_segments_per_task=40,
            max_candidate_lengths_per_task=3,
            max_candidate_starts_per_block=3,
        )
    if task_count >= 12 or block_count >= 20 or total_available_minutes >= 2400:
        return SolverProfile(
            max_candidate_segments_per_task=72,
            max_candidate_lengths_per_task=4,
            max_candidate_starts_per_block=4,
        )
    return SolverProfile(
        max_candidate_segments_per_task=MAX_CANDIDATE_SEGMENTS_PER_TASK,
        max_candidate_lengths_per_task=MAX_CANDIDATE_LENGTHS_PER_TASK,
        max_candidate_starts_per_block=9999,
    )


def build_task_candidate_lengths(task: Task, *, today: date, profile: SolverProfile) -> list[int]:
    """Generate and trim the candidate segment lengths for a task to fit the solver profile.

    Lengths are sorted by closeness to the ideal segment size, then truncated
    to profile.max_candidate_lengths_per_task.

    Args:
        task: The task to generate lengths for.
        today: The current date for overload eligibility checks.
        profile: The active solver profile controlling how many lengths to keep.

    Returns:
        A trimmed list of candidate segment lengths in preferred order.
    """
    lengths = build_candidate_lengths(
        task.estimate_minutes,
        task.cognitive_cap_minutes,
        task.can_use_emergency_overload(today),
    )
    unique_lengths = sorted(set(lengths))
    preferred = sorted(
        unique_lengths,
        key=lambda value: (
            abs(min(task.estimate_minutes, task.cognitive_cap_minutes) - value),
            -value,
        ),
    )
    return preferred[:profile.max_candidate_lengths_per_task]


def sample_evenly_by_timeline(
    candidates: list[SegmentCandidate],
    limit: int,
) -> list[SegmentCandidate]:
    """Downsample a candidate list to `limit` items distributed evenly across the timeline.

    Always includes the first and last candidates to preserve coverage of early
    and late placement options.

    Args:
        candidates: The full list of segment candidates, sorted by timeline position.
        limit: The maximum number of candidates to return.

    Returns:
        A subsampled list of up to `limit` candidates.
    """
    if len(candidates) <= limit:
        return candidates

    selected_indexes = {0, len(candidates) - 1}
    if limit == 1:
        selected_indexes = {0}
    else:
        for sample_index in range(limit):
            timeline_index = round(sample_index * (len(candidates) - 1) / (limit - 1))
            selected_indexes.add(timeline_index)

    sampled = [candidates[index] for index in sorted(selected_indexes)]
    if len(sampled) > limit:
        return sampled[:limit]
    return sampled


def sample_candidate_starts(block: TimeBlock, length: int, *, max_candidate_starts: int) -> list[datetime]:
    """Sample up to max_candidate_starts evenly spaced start times within a block.

    For large blocks with many possible start positions, this reduces the number
    of CP-SAT decision variables while preserving early, middle, and late options.

    Args:
        block: The availability block to sample starts from.
        length: The segment length in minutes.
        max_candidate_starts: Maximum number of start times to return.

    Returns:
        A list of sampled start datetimes, always including the earliest and latest.
    """
    latest_start = block.end - timedelta(minutes=length)
    starts: list[datetime] = []
    cursor = block.start
    while cursor <= latest_start:
        starts.append(cursor)
        cursor += timedelta(minutes=SCHEDULING_STEP_MINUTES)

    if len(starts) <= max_candidate_starts:
        return starts
    if max_candidate_starts <= 2:
        indexes = {0, len(starts) - 1}
    elif max_candidate_starts == 3:
        indexes = {0, len(starts) // 2, len(starts) - 1}
    else:
        indexes = {0, len(starts) - 1, len(starts) // 3, (2 * len(starts)) // 3}
    return [starts[index] for index in sorted(indexes)]


def generate_task_segment_candidates(
    task: Task,
    time_blocks: list[TimeBlock],
    *,
    today: date,
    profile: SolverProfile,
) -> list[SegmentCandidate]:
    """Generate all valid segment placement candidates for a task within available blocks.

    Candidates are generated for each (block, length, start) combination, deduplicated,
    sorted by quality (closeness to ideal size and timeline position), then downsampled
    to the solver profile limit.

    Args:
        task: The task to generate candidates for.
        time_blocks: All available time blocks.
        today: The current date for overload and due-date checks.
        profile: The active solver profile controlling candidate limits.

    Returns:
        A list of SegmentCandidates evenly sampled across the timeline.
    """
    eligible_blocks = build_eligible_blocks(task, time_blocks)
    if not eligible_blocks:
        return []

    candidates: list[SegmentCandidate] = []
    seen: set[tuple[str, str]] = set()
    candidate_lengths = build_task_candidate_lengths(task, today=today, profile=profile)

    for block in eligible_blocks:
        for length in candidate_lengths:
            if block.duration_minutes < length:
                continue

            for cursor in sample_candidate_starts(
                block,
                length,
                max_candidate_starts=profile.max_candidate_starts_per_block,
            ):
                end = cursor + timedelta(minutes=length)
                key = (cursor.isoformat(), end.isoformat())
                if key not in seen:
                    seen.add(key)
                    candidates.append(
                        SegmentCandidate(
                            task=task,
                            segment=Segment(
                                task_id=task.id,
                                title=task.title,
                                cognitive_load=task.cognitive_load,
                                start=cursor,
                                end=end,
                                block_start=block.start,
                                block_end=block.end,
                            ),
                            used_emergency_overload=length > task.cognitive_cap_minutes,
                        )
                    )

    candidates.sort(
        key=lambda candidate: (
            abs(task.estimate_minutes - candidate.segment.allocated_minutes),
            abs(task.cognitive_cap_minutes - candidate.segment.allocated_minutes),
            candidate.segment.start,
        )
    )

    evenly_spaced = sorted(
        sample_evenly_by_timeline(candidates, profile.max_candidate_segments_per_task),
        key=lambda candidate: candidate.segment.start,
    )
    return evenly_spaced


def segments_conflict(first: Segment, second: Segment) -> bool:
    """Return True if two segments overlap in time or violate a recovery gap constraint.

    Overlap is checked first. High-load segments from different tasks additionally
    require a minimum gap defined by DIFFERENT_TASK_RECOVERY_MINUTES.

    Args:
        first: The first segment.
        second: The second segment.

    Returns:
        True if the segments conflict, False if they are compatible.
    """
    if first.end > second.start and second.end > first.start:
        return True

    if first.cognitive_load == second.cognitive_load == "high" and first.task_id != second.task_id:
        required_gap = timedelta(minutes=DIFFERENT_TASK_RECOVERY_MINUTES["high"])
        if first.end <= second.start:
            return second.start - first.end < required_gap
        if second.end <= first.start:
            return first.start - second.end < required_gap
        return True

    return False


def plans_conflict(first_plan: list[Segment], second_plan: list[Segment]) -> bool:
    """Return True if any segment in first_plan conflicts with any segment in second_plan.

    Args:
        first_plan: Segments from the first task plan.
        second_plan: Segments from the second task plan.

    Returns:
        True if at least one pair of segments conflicts.
    """
    return any(
        segments_conflict(first_segment, second_segment)
        for first_segment in first_plan
        for second_segment in second_plan
    )


def iter_segment_slot_starts(segment: Segment) -> list[datetime]:
    """Return all scheduling step start times occupied by a segment.

    Used to build slot-occupancy constraints in the CP-SAT model, ensuring
    no two segments are placed in the same time slot.

    Args:
        segment: The segment to enumerate slots for.

    Returns:
        A list of datetimes, one per SCHEDULING_STEP_MINUTES interval within the segment.
    """
    slot_starts: list[datetime] = []
    cursor = segment.start
    while cursor < segment.end:
        slot_starts.append(cursor)
        cursor += timedelta(minutes=SCHEDULING_STEP_MINUTES)
    return slot_starts


# ---------------------------------------------------------------------------
# CP-SAT solver
# ---------------------------------------------------------------------------

class IncumbentCollector(cp_model.CpSolverSolutionCallback):
    """CP-SAT callback that captures the best incumbent solution during search.

    Because the solver may be stopped by the time limit before proving optimality,
    this callback records the best feasible solution found so it can be used
    even if the final solver status is not OPTIMAL or FEASIBLE.

    Attributes:
        has_solution: True if at least one feasible solution has been found.
        complete_task_ids: IDs of tasks marked complete in the best solution.
        selected_candidate_indexes: Indexes into all_candidate_vars for selected segments.
    """

    def __init__(
        self,
        complete_vars: dict[str, cp_model.IntVar],
        candidate_vars: list[tuple[SegmentCandidate, cp_model.IntVar]],
    ) -> None:
        """Initialize the collector with references to the model's decision variables.

        Args:
            complete_vars: Mapping from task ID to its completion boolean variable.
            candidate_vars: Ordered list of (SegmentCandidate, BoolVar) pairs.
        """
        super().__init__()
        self._complete_vars = complete_vars
        self._candidate_vars = candidate_vars
        self.has_solution = False
        self.complete_task_ids: set[str] = set()
        self.selected_candidate_indexes: set[int] = set()

    def on_solution_callback(self) -> None:
        """Record the current incumbent solution when the solver finds a new best."""
        self.has_solution = True
        self.complete_task_ids = {
            task_id
            for task_id, complete_var in self._complete_vars.items()
            if self.Value(complete_var)
        }
        self.selected_candidate_indexes = {
            index
            for index, (_, candidate_var) in enumerate(self._candidate_vars)
            if self.Value(candidate_var)
        }


def solve_with_cp_sat(
    tasks: list[Task],
    time_blocks: list[TimeBlock],
    *,
    now: datetime,
) -> tuple[list[dict], list[dict], str]:
    """Schedule tasks using the OR-Tools CP-SAT constraint programming solver.

    Builds a binary optimization model where each task has a completion variable
    and each candidate segment placement has a selection variable. The model
    enforces no-overlap, recovery gap, and cognitive load constraints, then
    maximizes a weighted objective that favors urgent, high-priority tasks.

    If the solver finds no solution within the time limit, all tasks are returned
    as unscheduled. After solving, a greedy repair pass attempts to fit any tasks
    the solver left unscheduled.

    Args:
        tasks: The tasks to schedule.
        time_blocks: Available time blocks.
        now: The current datetime, used for date-relative calculations.

    Returns:
        A tuple of (scheduled payloads, unscheduled payloads, solver name string).
    """
    model = cp_model.CpModel()
    profile = build_solver_profile(
        len(tasks),
        len(time_blocks),
        sum(block.duration_minutes for block in time_blocks),
    )
    complete_vars: dict[str, cp_model.IntVar] = {}
    task_candidate_vars: dict[str, list[tuple[SegmentCandidate, cp_model.IntVar]]] = {}
    all_candidate_vars: list[tuple[SegmentCandidate, cp_model.IntVar]] = []

    for task in tasks:
        complete_var = model.NewBoolVar(f"{task.id}_complete")
        complete_vars[task.id] = complete_var

        candidates = generate_task_segment_candidates(task, time_blocks, today=now.date(), profile=profile)
        if not candidates:
            model.Add(complete_var == 0)
            continue

        scoped_candidates: list[tuple[SegmentCandidate, cp_model.IntVar]] = []
        for candidate_index, candidate in enumerate(candidates):
            candidate_var = model.NewBoolVar(f"{task.id}_segment_{candidate_index}")
            scoped_candidates.append((candidate, candidate_var))
            all_candidate_vars.append((candidate, candidate_var))

        task_candidate_vars[task.id] = scoped_candidates
        model.Add(
            sum(candidate.segment.allocated_minutes * candidate_var for candidate, candidate_var in scoped_candidates)
            == task.estimate_minutes * complete_var
        )

        for index, (first_candidate, first_var) in enumerate(scoped_candidates):
            for second_candidate, second_var in scoped_candidates[index + 1 :]:
                if violates_recovery_gap(task, first_candidate.segment.start, first_candidate.segment.end, [second_candidate.segment]):
                    model.Add(first_var + second_var <= 1)
                elif violates_recovery_gap(task, second_candidate.segment.start, second_candidate.segment.end, [first_candidate.segment]):
                    model.Add(first_var + second_var <= 1)

    slot_occupancy: dict[datetime, list[cp_model.IntVar]] = {}
    for candidate, candidate_var in all_candidate_vars:
        for slot_start in iter_segment_slot_starts(candidate.segment):
            slot_occupancy.setdefault(slot_start, []).append(candidate_var)

    for slot_vars in slot_occupancy.values():
        model.Add(sum(slot_vars) <= 1)

    high_load_candidates = [
        (candidate, candidate_var)
        for candidate, candidate_var in all_candidate_vars
        if candidate.segment.cognitive_load == "high"
    ]
    for index, (first_candidate, first_var) in enumerate(high_load_candidates):
        for second_candidate, second_var in high_load_candidates[index + 1 :]:
            if first_candidate.task.id == second_candidate.task.id:
                continue
            if segments_conflict(first_candidate.segment, second_candidate.segment):
                model.Add(first_var + second_var <= 1)

    objective_terms: list[cp_model.LinearExpr] = []
    for task in tasks:
        objective_terms.append(scheduled_task_value(task, today=now.date()) * complete_vars[task.id])
        scoped_candidates = task_candidate_vars.get(task.id, [])
        for candidate, candidate_var in scoped_candidates:
            objective_terms.append(-2_000 * candidate_var)
            if candidate.used_emergency_overload:
                objective_terms.append(-task.emergency_overload_penalty(now.date()) * candidate_var)

    if objective_terms:
        model.Maximize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = SOLVER_TIME_LIMIT_SECONDS
    solver.parameters.num_search_workers = 8
    incumbent = IncumbentCollector(complete_vars, all_candidate_vars)

    status = solver.Solve(model, incumbent)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE) and not incumbent.has_solution:
        unscheduled = [
            build_incomplete_payload(
                task,
                infer_unscheduled_reason(task, time_blocks),
            )
            for task in tasks
        ]
        return [], sorted(unscheduled, key=lambda item: (item["dueDate"], item["title"].lower())), "python-cp-sat"

    selected_segments_by_task: dict[str, list[Segment]] = {}
    selected_task_ids: set[str] = set()
    used_overload_by_task: dict[str, bool] = {}

    solver_name = "python-cp-sat" if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else "python-cp-sat-timeboxed"

    for index, (candidate, candidate_var) in enumerate(all_candidate_vars):
        is_selected = index in incumbent.selected_candidate_indexes if incumbent.has_solution else bool(solver.Value(candidate_var))
        if is_selected:
            selected_segments_by_task.setdefault(candidate.task.id, []).append(candidate.segment)
            used_overload_by_task[candidate.task.id] = (
                used_overload_by_task.get(candidate.task.id, False) or candidate.used_emergency_overload
            )

    scheduled: list[dict] = []
    for task in tasks:
        is_complete = task.id in incumbent.complete_task_ids if incumbent.has_solution else bool(solver.Value(complete_vars[task.id]))
        if is_complete and task.id in selected_segments_by_task:
            segments = sorted(selected_segments_by_task[task.id], key=lambda segment: segment.start)
            scheduled.append(
                rebuild_payload(
                    task,
                    segments,
                    used_emergency_overload=used_overload_by_task.get(task.id, False),
                )
            )
            selected_task_ids.add(task.id)

    unscheduled = [
        build_incomplete_payload(
            task,
            infer_unscheduled_reason(task, time_blocks, scheduled_count=len(scheduled)),
        )
        for task in tasks
        if task.id not in selected_task_ids
    ]

    scheduled.sort(key=lambda item: datetime.fromisoformat(item["segments"][0]["start"]))
    unscheduled.sort(key=lambda item: (item["dueDate"], item["title"].lower()))

    if unscheduled:
        unscheduled_task_lookup = {task.id: task for task in tasks}
        repair_candidates = [
            unscheduled_task_lookup[item["id"]]
            for item in unscheduled
            if item["id"] in unscheduled_task_lookup
        ]
        repaired_schedule, repaired_unscheduled = fill_unscheduled_tasks_greedily(
            scheduled,
            repair_candidates,
            time_blocks,
            now=now,
        )
        if len(repaired_schedule) > len(scheduled):
            scheduled = repaired_schedule
            unscheduled = repaired_unscheduled
            solver_name = f"{solver_name}+greedy-repair"

    return scheduled, unscheduled, solver_name


# ---------------------------------------------------------------------------
# Day repacking
# ---------------------------------------------------------------------------

def split_block_into_windows(block: TimeBlock, window_minutes: int) -> list[TimeBlock]:
    """Split a time block into consecutive fixed-size windows for repacking.

    The last window may be shorter than window_minutes if the block length
    is not evenly divisible.

    Args:
        block: The block to split.
        window_minutes: The target window size in minutes.

    Returns:
        A list of non-overlapping TimeBlocks covering the full block.
    """
    windows: list[TimeBlock] = []
    cursor = block.start

    while cursor < block.end:
        next_end = min(cursor + timedelta(minutes=window_minutes), block.end)
        windows.append(TimeBlock(start=cursor, end=next_end))
        cursor = next_end

    return windows


def segment_inside_block(segment: Segment, block: TimeBlock) -> bool:
    """Return True if the segment is fully contained within the block.

    Args:
        segment: The segment to check.
        block: The containing block.

    Returns:
        True if segment.start >= block.start and segment.end <= block.end.
    """
    return segment.start >= block.start and segment.end <= block.end


def repack_window_segments(
    window: TimeBlock,
    segments: list[Segment],
    pack_to_start: bool,
) -> list[Segment]:
    """Repack segments within a window by shifting them to the start or end.

    When packing to start, segments are moved to begin at window.start with
    no gaps between them. When packing to end, segments are moved to finish
    at window.end. This creates contiguous free space on the opposite side,
    enabling new tasks to be inserted.

    Args:
        window: The window to repack within.
        segments: The segments to repack, already filtered to this window.
        pack_to_start: If True, pack segments to the beginning of the window;
                       if False, pack to the end.

    Returns:
        A list of repacked Segment objects with updated start/end times.
    """
    ordered = sorted(segments, key=lambda segment: (segment.start, segment.end, segment.task_id))
    if not ordered:
        return []

    repacked: list[Segment] = []
    if pack_to_start:
        cursor = window.start
        for segment in ordered:
            length = timedelta(minutes=segment.allocated_minutes)
            repacked.append(
                Segment(
                    task_id=segment.task_id,
                    title=segment.title,
                    cognitive_load=segment.cognitive_load,
                    start=cursor,
                    end=cursor + length,
                    block_start=segment.block_start,
                    block_end=segment.block_end,
                )
            )
            cursor += length
        return repacked

    cursor = window.end
    reversed_segments: list[Segment] = []
    for segment in reversed(ordered):
        length = timedelta(minutes=segment.allocated_minutes)
        next_start = cursor - length
        reversed_segments.append(
            Segment(
                task_id=segment.task_id,
                title=segment.title,
                cognitive_load=segment.cognitive_load,
                start=next_start,
                end=cursor,
                block_start=segment.block_start,
                block_end=segment.block_end,
            )
        )
        cursor = next_start

    return list(reversed(reversed_segments))


def violates_any_recovery_gap(segments: list[Segment]) -> bool:
    """Return True if any segment in the list violates a recovery gap with another.

    Used to validate repacked schedules before committing them, since repacking
    can inadvertently close gaps that were previously respecting recovery rules.

    Args:
        segments: All segments to check pairwise.

    Returns:
        True if any recovery gap violation is found.
    """
    ordered = sorted(segments, key=lambda segment: (segment.start, segment.end))
    for index, segment in enumerate(ordered):
        task = Task(
            id=segment.task_id,
            title=segment.title,
            estimate_minutes=segment.allocated_minutes,
            due_date=segment.start.date(),
            priority="medium",
            cognitive_load=segment.cognitive_load,
            status="new",
        )
        others = ordered[:index] + ordered[index + 1 :]
        if violates_recovery_gap(task, segment.start, segment.end, others):
            return True
    return False


def rebuild_segments_for_day(
    base_time_blocks: list[TimeBlock],
    day_segments: list[Segment],
    day_value: date,
) -> list[Segment] | None:
    """Attempt to repack all segments on a given day to create contiguous free space.

    Splits each day block into REPACK_WINDOW_MINUTES windows and alternately
    packs windows to the start and end. The result is validated against recovery
    gap constraints before being returned.

    Args:
        base_time_blocks: All available time blocks (used to find blocks on this day).
        day_segments: All segments currently scheduled on this day.
        day_value: The date to repack.

    Returns:
        A repacked list of Segments if repacking is valid and changes were made,
        or None if repacking fails validation or produces no change.
    """
    day_blocks = [
        block
        for block in base_time_blocks
        if block.start.date() == day_value and block.duration_minutes >= MINIMUM_WORK_BLOCK_MINUTES
    ]
    if not day_blocks:
        return None

    repacked_segments: list[Segment] = []
    used_keys: set[tuple[str, str, str]] = set()

    for block in sorted(day_blocks, key=lambda item: item.start):
        block_segments = [
            segment
            for segment in day_segments
            if segment_inside_block(segment, block)
        ]
        if not block_segments:
            continue

        for index, window in enumerate(split_block_into_windows(block, REPACK_WINDOW_MINUTES)):
            window_segments = [
                segment
                for segment in block_segments
                if segment_inside_block(segment, window)
            ]
            for segment in window_segments:
                used_keys.add((segment.task_id, segment.start.isoformat(), segment.end.isoformat()))

            repacked_segments.extend(
                repack_window_segments(window, window_segments, pack_to_start=index % 2 == 0)
            )

    untouched_segments = [
        segment
        for segment in day_segments
        if (segment.task_id, segment.start.isoformat(), segment.end.isoformat()) not in used_keys
    ]
    combined = sorted(repacked_segments + untouched_segments, key=lambda segment: (segment.start, segment.end))
    if violates_any_recovery_gap(combined):
        return None
    return combined


def group_blocks_by_day(blocks: list[TimeBlock]) -> dict[date, list[TimeBlock]]:
    """Group a list of time blocks by their start date.

    Args:
        blocks: The blocks to group.

    Returns:
        A dict mapping each date to the list of blocks starting on that date.
    """
    grouped: dict[date, list[TimeBlock]] = {}
    for block in blocks:
        grouped.setdefault(block.start.date(), []).append(block)
    return grouped


def group_segments_by_task(segments: list[Segment]) -> dict[str, list[Segment]]:
    """Group a list of segments by their task ID.

    Args:
        segments: The segments to group.

    Returns:
        A dict mapping each task ID to the list of segments for that task.
    """
    grouped: dict[str, list[Segment]] = {}
    for segment in segments:
        grouped.setdefault(segment.task_id, []).append(segment)
    return grouped


def try_repack_day_for_task(
    task: Task,
    all_time_blocks: list[TimeBlock],
    ordered_tasks: list[Task],
    scheduled_payloads: list[dict],
    committed_segments: list[Segment],
    *,
    now: datetime,
    reverse_blocks: bool = False,
    reverse_starts: bool = False,
    reverse_lengths: bool = False,
) -> tuple[list[dict], list[Segment], list[Segment] | None, bool]:
    """Try to create space for an unscheduled task by repacking segments on a candidate day.

    Finds days with enough total free time but no single block large enough for the task,
    then repacks existing segments to consolidate free space. If the task can be placed
    after repacking, the updated schedule and new segments are returned.

    Args:
        task: The task to fit via repacking.
        all_time_blocks: All available time blocks.
        ordered_tasks: All tasks in scheduling order (used for payload rebuilding).
        scheduled_payloads: Current list of scheduled task payloads.
        committed_segments: Currently committed segment list.
        now: Current datetime reference.
        reverse_blocks: Passed through to try_schedule_task_greedily.
        reverse_starts: Passed through to try_schedule_task_greedily.
        reverse_lengths: Passed through to try_schedule_task_greedily.

    Returns:
        A tuple of (updated scheduled payloads, updated committed segments,
        new segments for this task or None, used_emergency_overload flag).
        Returns the original payloads and segments unchanged if repacking fails.
    """
    due_cutoff = task.due_cutoff_for(all_time_blocks[0].start)
    free_blocks = subtract_segments_from_blocks(all_time_blocks, committed_segments)
    free_by_day = group_blocks_by_day([block for block in free_blocks if block.start < due_cutoff])
    if not free_by_day:
        return scheduled_payloads, committed_segments, None, False

    candidate_days = []
    for day_value, day_blocks in free_by_day.items():
        total_open_minutes = sum(block.duration_minutes for block in day_blocks)
        longest_open_minutes = max((block.duration_minutes for block in day_blocks), default=0)
        if total_open_minutes < MINIMUM_WORK_BLOCK_MINUTES or longest_open_minutes >= task.estimate_minutes:
            continue
        candidate_days.append((day_value, total_open_minutes))

    candidate_days.sort(key=lambda item: (item[1], item[0]), reverse=True)
    if not candidate_days:
        return scheduled_payloads, committed_segments, None, False

    task_lookup = {item.id: item for item in ordered_tasks}
    original_payloads = [dict(payload) for payload in scheduled_payloads]

    for day_value, _ in candidate_days:
        day_segments = [segment for segment in committed_segments if segment.start.date() == day_value]
        if not day_segments:
            continue

        repacked_day_segments = rebuild_segments_for_day(all_time_blocks, day_segments, day_value)
        if repacked_day_segments is None or repacked_day_segments == sorted(day_segments, key=lambda segment: (segment.start, segment.end)):
            continue

        other_segments = [segment for segment in committed_segments if segment.start.date() != day_value]
        candidate_committed = sorted(other_segments + repacked_day_segments, key=lambda segment: (segment.start, segment.end))

        repacked_payloads: list[dict] = []
        repacked_by_task = group_segments_by_task(repacked_day_segments)
        for payload in original_payloads:
            moved_segments = repacked_by_task.get(payload["id"])
            if moved_segments is None:
                repacked_payloads.append(payload)
                continue

            original_task = task_lookup[payload["id"]]
            used_emergency_overload = any(
                segment.allocated_minutes > original_task.cognitive_cap_minutes
                for segment in moved_segments
            ) or payload.get("usedEmergencyOverload", False)
            repacked_payloads.append(rebuild_payload(original_task, moved_segments, used_emergency_overload=used_emergency_overload))

        scheduled_segments, used_emergency_overload = try_schedule_task_greedily(
            task,
            all_time_blocks,
            candidate_committed,
            today=now.date(),
            reverse_blocks=reverse_blocks,
            reverse_starts=reverse_starts,
            reverse_lengths=reverse_lengths,
        )
        if scheduled_segments is None:
            continue

        return repacked_payloads, candidate_committed, scheduled_segments, used_emergency_overload

    return scheduled_payloads, committed_segments, None, False


# ---------------------------------------------------------------------------
# Greedy scheduler
# ---------------------------------------------------------------------------

def greedy_schedule(
    ordered_tasks: list[Task],
    time_blocks: list[TimeBlock],
    *,
    now: datetime,
    reverse_blocks: bool = False,
    reverse_starts: bool = False,
    reverse_lengths: bool = False,
) -> tuple[list[dict], list[dict]]:
    """Schedule tasks one at a time using a greedy placement strategy.

    For each task in order, attempts direct placement first. If that fails,
    attempts a day-repacking pass to create space. Tasks that cannot be placed
    by either method are added to the unscheduled list with a reason code.

    Args:
        ordered_tasks: Tasks sorted in the desired scheduling priority order.
        time_blocks: All available time blocks.
        now: The current datetime reference.
        reverse_blocks: If True, try later blocks first during placement.
        reverse_starts: If True, try later start times first during placement.
        reverse_lengths: If True, try shorter segment lengths first.

    Returns:
        A tuple of (sorted scheduled payload list, sorted unscheduled payload list).
    """
    scheduled_payloads: list[dict] = []
    unscheduled_payloads: list[dict] = []
    committed_segments: list[Segment] = []

    for task in ordered_tasks:
        segments, used_emergency_overload = try_schedule_task_greedily(
            task,
            time_blocks,
            committed_segments,
            today=now.date(),
            reverse_blocks=reverse_blocks,
            reverse_starts=reverse_starts,
            reverse_lengths=reverse_lengths,
        )
        if segments is not None:
            committed_segments.extend(segments)
            scheduled_payloads.append(rebuild_payload(task, segments, used_emergency_overload=used_emergency_overload))
            continue

        repacked_payloads, repacked_committed, repacked_segments, used_emergency_overload = try_repack_day_for_task(
            task,
            time_blocks,
            ordered_tasks,
            scheduled_payloads,
            committed_segments,
            now=now,
            reverse_blocks=reverse_blocks,
            reverse_starts=reverse_starts,
            reverse_lengths=reverse_lengths,
        )
        if repacked_segments is not None:
            scheduled_payloads = repacked_payloads
            committed_segments = repacked_committed + repacked_segments
            scheduled_payloads.append(rebuild_payload(task, repacked_segments, used_emergency_overload=used_emergency_overload))
            committed_segments = sorted(committed_segments, key=lambda segment: (segment.start, segment.end))
            continue

        unscheduled_payloads.append(
            build_incomplete_payload(
                task,
                infer_unscheduled_reason(task, time_blocks, scheduled_count=len(scheduled_payloads)),
            )
        )

    scheduled = sorted(
        scheduled_payloads,
        key=lambda item: datetime.fromisoformat(item["segments"][0]["start"]),
    )
    unscheduled = sorted(
        unscheduled_payloads,
        key=lambda item: (item["dueDate"], item["title"].lower()),
    )
    return scheduled, unscheduled


def rebuild_segments_from_payloads(schedule: list[dict]) -> list[Segment]:
    """Reconstruct Segment dataclass instances from a list of serialized task payloads.

    Used by the greedy repair pass to rebuild the committed segment state from
    a previously computed schedule.

    Args:
        schedule: A list of scheduled task payload dicts (as returned by the API).

    Returns:
        A sorted list of Segment objects reconstructed from the payload data.
    """
    segments: list[Segment] = []
    for item in schedule:
        for raw_segment in item.get("segments", []):
            segments.append(
                Segment(
                    task_id=item["id"],
                    title=item["title"],
                    cognitive_load=item["cognitiveLoad"],
                    start=datetime.fromisoformat(raw_segment["start"]),
                    end=datetime.fromisoformat(raw_segment["end"]),
                    block_start=datetime.fromisoformat(raw_segment["blockStart"]),
                    block_end=datetime.fromisoformat(raw_segment["blockEnd"]),
                )
            )
    return sorted(segments, key=lambda segment: (segment.start, segment.end))


def fill_unscheduled_tasks_greedily(
    scheduled: list[dict],
    unscheduled_tasks: list[Task],
    time_blocks: list[TimeBlock],
    *,
    now: datetime,
) -> tuple[list[dict], list[dict]]:
    """Attempt to greedily place tasks that the CP-SAT solver left unscheduled.

    Used as a repair pass after CP-SAT to recover any tasks the solver could not
    fit within its time limit. Tasks are tried in sort_score order.

    Args:
        scheduled: The current list of scheduled task payloads from CP-SAT.
        unscheduled_tasks: Task objects for all unscheduled tasks.
        time_blocks: All available time blocks.
        now: The current datetime reference.

    Returns:
        A tuple of (updated scheduled payloads, remaining unscheduled payloads).
    """
    committed_segments = rebuild_segments_from_payloads(scheduled)
    repaired_schedule = list(scheduled)
    remaining_unscheduled: list[dict] = []

    for task in sorted(unscheduled_tasks, key=lambda item: item.sort_score(now.date())):
        segments, used_emergency_overload = try_schedule_task_greedily(
            task,
            time_blocks,
            committed_segments,
            today=now.date(),
        )
        if segments is not None:
            committed_segments.extend(segments)
            committed_segments.sort(key=lambda segment: (segment.start, segment.end))
            repaired_schedule.append(
                rebuild_payload(task, segments, used_emergency_overload=used_emergency_overload)
            )
            continue

        remaining_unscheduled.append(
            build_incomplete_payload(
                task,
                infer_unscheduled_reason(task, time_blocks, scheduled_count=len(repaired_schedule)),
            )
        )

    repaired_schedule.sort(key=lambda item: datetime.fromisoformat(item["segments"][0]["start"]))
    remaining_unscheduled.sort(key=lambda item: (item["dueDate"], item["title"].lower()))
    return repaired_schedule, remaining_unscheduled


# ---------------------------------------------------------------------------
# Top-level scheduler entry point
# ---------------------------------------------------------------------------

def schedule_tasks(time_blocks: list[TimeBlock], tasks: list[Task], *, now: datetime | None = None) -> dict:
    """Run the full scheduling pipeline and return a structured result payload.

    First attempts CP-SAT optimization. Falls back to greedy scheduling if the
    solver raises an exception. Returns a complete summary, metadata, scheduled
    task list, and unscheduled task list.

    Args:
        time_blocks: Available time blocks provided by the frontend.
        tasks: Tasks to schedule.
        now: Optional override for the current datetime (defaults to datetime.now()).

    Returns:
        A dict with 'summary', 'meta', 'schedule', and 'unscheduled' keys,
        suitable for direct use as the API JSON response body.
    """
    reference_now = now or datetime.now()
    started_at = clock.perf_counter()
    ordered_blocks = sorted(time_blocks, key=lambda block: block.start)
    ordered_tasks = sorted(tasks, key=lambda task: task.sort_score(reference_now.date()))

    try:
        schedule, unscheduled, solver_name = solve_with_cp_sat(
            ordered_tasks,
            ordered_blocks,
            now=reference_now,
        )
    except Exception:
        schedule, unscheduled = greedy_schedule(ordered_tasks, ordered_blocks, now=reference_now)
        solver_name = "python-greedy-fallback"

    elapsed_ms = round((clock.perf_counter() - started_at) * 1000, 2)

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
        "meta": {
            "solver": solver_name,
            "elapsedMs": elapsed_ms,
            "generatedAt": datetime.now(reference_now.tzinfo).isoformat() if reference_now.tzinfo else datetime.now().isoformat(),
            "taskCount": len(tasks),
            "timeBlockCount": len(ordered_blocks),
        },
        "schedule": schedule,
        "unscheduled": unscheduled,
    }


# ---------------------------------------------------------------------------
# Flask routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health_check():
    """Return a simple health check response to confirm the backend is running.

    Returns:
        JSON response: {"status": "ok"} with HTTP 200.
    """
    return jsonify({"status": "ok"})


@app.post("/api/schedule")
def create_schedule():
    """Accept a scheduling request and return an optimized schedule.

    Expects a JSON body with 'timeBlocks' and 'tasks' arrays. Validates that
    blocks and tasks are present, blocks end after they start, task estimates
    are positive, and all block boundaries align to 15-minute steps.

    Returns:
        JSON response with 'summary', 'meta', 'schedule', and 'unscheduled' keys,
        or a 400 error response if validation fails.
    """
    app.logger.info(
        "schedule POST started: content_length=%s, remote=%s",
        request.content_length,
        request.remote_addr,
    )
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
        "schedule result: %s scheduled, %s unscheduled, solver=%s, elapsedMs=%s",
        len(result["schedule"]),
        len(result["unscheduled"]),
        result["meta"]["solver"],
        result["meta"]["elapsedMs"],
    )
    return jsonify(result)


if __name__ == "__main__":
    port = int(os.environ.get("FLASK_PORT", "5050"))
    app.run(host="127.0.0.1", port=port, threaded=True)