from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path
from statistics import mean

from server import parse_task, parse_time_block, schedule_tasks


DEFAULT_BASE_DATE = datetime(2026, 4, 28, 8, 0)
DEFAULT_BLOCK_STARTS = ("09:00", "10:15", "11:30")


def build_time_blocks(days: int, block_starts: tuple[str, ...], block_minutes: int) -> list:
    blocks = []
    for day_offset in range(days):
        day = DEFAULT_BASE_DATE + timedelta(days=day_offset)
        for start_text in block_starts:
            start_hour, start_minute = map(int, start_text.split(":"))
            start = day.replace(hour=start_hour, minute=start_minute, second=0, microsecond=0)
            end = start + timedelta(minutes=block_minutes)
            blocks.append(
                parse_time_block(
                    {
                        "start": start.isoformat(),
                        "end": end.isoformat(),
                    }
                )
            )
    return blocks


def build_tasks(
    task_count: int,
    *,
    estimate_minutes: int,
    due_spacing_days: int,
) -> list:
    priorities = ("high", "medium", "medium", "low", "low")
    cognitive_loads = ("low", "medium", "low", "medium", "low", "high")
    tasks = []
    for index in range(task_count):
        due_date = (DEFAULT_BASE_DATE.date() + timedelta(days=4 + index * due_spacing_days)).isoformat()
        tasks.append(
            parse_task(
                {
                    "id": str(index + 1),
                    "title": f"Benchmark Task {index + 1}",
                    "estimateMinutes": estimate_minutes,
                    "dueDate": due_date,
                    "priority": priorities[index % len(priorities)],
                    "cognitiveLoad": cognitive_loads[index % len(cognitive_loads)],
                    "status": "new",
                }
            )
        )
    return tasks


def load_request_fixture(path: str) -> tuple[list, list]:
    fixture = json.loads(Path(path).read_text(encoding="utf-8"))
    request_payload = fixture.get("scheduleRequest", {}).get("request", fixture)
    blocks = [parse_time_block(item) for item in request_payload.get("timeBlocks", [])]
    tasks = [parse_task(item) for item in request_payload.get("tasks", [])]
    return blocks, tasks


def run_benchmark(
    *,
    task_count: int,
    runs: int,
    days: int,
    block_minutes: int,
    estimate_minutes: int,
    due_spacing_days: int,
) -> int:
    blocks = build_time_blocks(days, DEFAULT_BLOCK_STARTS, block_minutes)
    tasks = build_tasks(
        task_count,
        estimate_minutes=estimate_minutes,
        due_spacing_days=due_spacing_days,
    )

    timings: list[float] = []
    last_result = None

    for run_index in range(runs):
        result = schedule_tasks(blocks, tasks, now=DEFAULT_BASE_DATE)
        timings.append(float(result["meta"]["elapsedMs"]))
        last_result = result
        scheduled_minutes = sum(
            sum(segment["allocatedMinutes"] for segment in item["segments"])
            for item in result["schedule"]
        )
        unscheduled_task_minutes = sum(item.get("missingMinutes", 0) for item in result["unscheduled"])
        unused_available_minutes = result["summary"]["totalAvailableMinutes"] - scheduled_minutes
        print(
            f"run {run_index + 1}: "
            f"{result['meta']['elapsedMs']} ms | "
            f"solver={result['meta']['solver']} | "
            f"scheduled={result['summary']['scheduledCount']} | "
            f"unscheduled={result['summary']['unscheduledCount']} | "
            f"unscheduled_task_minutes={unscheduled_task_minutes} | "
            f"unused_available_minutes={unused_available_minutes}"
        )

    assert last_result is not None
    scheduled_minutes = sum(
        sum(segment["allocatedMinutes"] for segment in item["segments"])
        for item in last_result["schedule"]
    )
    unscheduled_task_minutes = sum(item.get("missingMinutes", 0) for item in last_result["unscheduled"])
    unused_available_minutes = last_result["summary"]["totalAvailableMinutes"] - scheduled_minutes
    print()
    print("summary")
    print(f"task_count: {task_count}")
    print(f"runs: {runs}")
    print(f"time_blocks: {len(blocks)}")
    print(f"estimate_minutes: {estimate_minutes}")
    print(f"solver: {last_result['meta']['solver']}")
    print(f"min_ms: {min(timings):.2f}")
    print(f"avg_ms: {mean(timings):.2f}")
    print(f"max_ms: {max(timings):.2f}")
    print(f"scheduled_count: {last_result['summary']['scheduledCount']}")
    print(f"unscheduled_count: {last_result['summary']['unscheduledCount']}")
    print(f"scheduled_minutes: {scheduled_minutes}")
    print(f"unscheduled_task_minutes: {unscheduled_task_minutes}")
    print(f"unused_available_minutes: {unused_available_minutes}")
    return 0


def run_fixture_benchmark(*, path: str, runs: int) -> int:
    blocks, tasks = load_request_fixture(path)
    timings: list[float] = []
    last_result = None

    for run_index in range(runs):
      result = schedule_tasks(blocks, tasks, now=DEFAULT_BASE_DATE)
      timings.append(float(result["meta"]["elapsedMs"]))
      last_result = result
      scheduled_minutes = sum(
          sum(segment["allocatedMinutes"] for segment in item["segments"])
          for item in result["schedule"]
      )
      unscheduled_task_minutes = sum(item.get("missingMinutes", 0) for item in result["unscheduled"])
      unused_available_minutes = result["summary"]["totalAvailableMinutes"] - scheduled_minutes
      print(
          f"run {run_index + 1}: "
          f"{result['meta']['elapsedMs']} ms | "
          f"solver={result['meta']['solver']} | "
          f"scheduled={result['summary']['scheduledCount']} | "
          f"unscheduled={result['summary']['unscheduledCount']} | "
          f"unscheduled_task_minutes={unscheduled_task_minutes} | "
          f"unused_available_minutes={unused_available_minutes}"
      )

    assert last_result is not None
    scheduled_minutes = sum(
        sum(segment["allocatedMinutes"] for segment in item["segments"])
        for item in last_result["schedule"]
    )
    unscheduled_task_minutes = sum(item.get("missingMinutes", 0) for item in last_result["unscheduled"])
    unused_available_minutes = last_result["summary"]["totalAvailableMinutes"] - scheduled_minutes
    print()
    print("summary")
    print(f"fixture: {path}")
    print(f"runs: {runs}")
    print(f"time_blocks: {len(blocks)}")
    print(f"task_count: {len(tasks)}")
    print(f"solver: {last_result['meta']['solver']}")
    print(f"min_ms: {min(timings):.2f}")
    print(f"avg_ms: {mean(timings):.2f}")
    print(f"max_ms: {max(timings):.2f}")
    print(f"scheduled_count: {last_result['summary']['scheduledCount']}")
    print(f"unscheduled_count: {last_result['summary']['unscheduledCount']}")
    print(f"scheduled_minutes: {scheduled_minutes}")
    print(f"unscheduled_task_minutes: {unscheduled_task_minutes}")
    print(f"unused_available_minutes: {unused_available_minutes}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run repeatable backend scheduling smoke benchmarks.")
    parser.add_argument("--fixture", type=str, help="Path to an exported debug bundle or raw schedule request JSON.")
    parser.add_argument("--tasks", type=int, default=6, help="Number of tasks to generate.")
    parser.add_argument("--runs", type=int, default=5, help="How many benchmark runs to execute.")
    parser.add_argument("--days", type=int, default=4, help="How many days of availability to generate.")
    parser.add_argument("--block-minutes", type=int, default=60, help="Length of each availability block in minutes.")
    parser.add_argument("--estimate-minutes", type=int, default=60, help="Estimate minutes for each generated task.")
    parser.add_argument("--due-spacing-days", type=int, default=1, help="Days between generated task due dates.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.fixture:
        return run_fixture_benchmark(path=args.fixture, runs=args.runs)
    return run_benchmark(
        task_count=args.tasks,
        runs=args.runs,
        days=args.days,
        block_minutes=args.block_minutes,
        estimate_minutes=args.estimate_minutes,
        due_spacing_days=args.due_spacing_days,
    )


if __name__ == "__main__":
    raise SystemExit(main())
