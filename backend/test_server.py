import unittest
from datetime import date, datetime

from server import (
    app,
    parse_task,
    parse_time_block,
    schedule_tasks,
)


class SchedulerBackendTests(unittest.TestCase):
    def setUp(self):
        app.config["TESTING"] = True
        self.client = app.test_client()

    def test_health_endpoint_returns_ok(self):
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"status": "ok"})

    def test_schedule_endpoint_rejects_missing_time_blocks(self):
        response = self.client.post(
            "/api/schedule",
            json={
                "timeBlocks": [],
                "tasks": [
                    {
                        "id": "task-1",
                        "title": "Draft concept board",
                        "estimateMinutes": 60,
                        "dueDate": "2026-04-29",
                        "priority": "high",
                        "cognitiveLoad": "medium",
                    }
                ],
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {"error": "At least one time block is required."})

    def test_schedule_endpoint_rejects_missing_tasks(self):
        response = self.client.post(
            "/api/schedule",
            json={
                "timeBlocks": [
                    {
                        "start": "2026-04-28T09:00:00",
                        "end": "2026-04-28T11:00:00",
                    }
                ],
                "tasks": [],
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {"error": "At least one task is required."})

    def test_schedule_endpoint_rejects_invalid_time_blocks(self):
        response = self.client.post(
            "/api/schedule",
            json={
                "timeBlocks": [
                    {
                        "start": "2026-04-28T11:00:00",
                        "end": "2026-04-28T09:00:00",
                    }
                ],
                "tasks": [
                    {
                        "id": "task-1",
                        "title": "Draft concept board",
                        "estimateMinutes": 60,
                        "dueDate": "2026-04-29",
                        "priority": "high",
                        "cognitiveLoad": "medium",
                    }
                ],
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {"error": "Each time block must end after it starts."})

    def test_schedule_endpoint_rejects_non_positive_estimate(self):
        response = self.client.post(
            "/api/schedule",
            json={
                "timeBlocks": [
                    {
                        "start": "2026-04-28T09:00:00",
                        "end": "2026-04-28T11:00:00",
                    }
                ],
                "tasks": [
                    {
                        "id": "task-1",
                        "title": "Draft concept board",
                        "estimateMinutes": 0,
                        "dueDate": "2026-04-29",
                        "priority": "high",
                        "cognitiveLoad": "medium",
                    }
                ],
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {"error": "Each task estimate must be greater than zero."})

    def test_schedule_endpoint_rejects_non_aligned_time_blocks(self):
        response = self.client.post(
            "/api/schedule",
            json={
                "timeBlocks": [
                    {
                        "start": "2026-04-28T09:10:00",
                        "end": "2026-04-28T11:00:00",
                    }
                ],
                "tasks": [
                    {
                        "id": "task-1",
                        "title": "Draft concept board",
                        "estimateMinutes": 60,
                        "dueDate": "2026-04-29",
                        "priority": "high",
                        "cognitiveLoad": "medium",
                    }
                ],
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.get_json(),
            {"error": "Time blocks must align to 15-minute boundaries."},
        )

    def test_schedule_endpoint_accepts_timezone_aware_time_blocks(self):
        response = self.client.post(
            "/api/schedule",
            json={
                "timeBlocks": [
                    {
                        "start": "2026-04-28T09:00:00+00:00",
                        "end": "2026-04-28T10:00:00+00:00",
                    }
                ],
                "tasks": [
                    {
                        "id": "task-1",
                        "title": "Timezone-safe task",
                        "estimateMinutes": 60,
                        "dueDate": "2026-04-29",
                        "priority": "medium",
                        "cognitiveLoad": "low",
                    }
                ],
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["summary"]["scheduledCount"], 1)

    def test_parse_helpers_create_expected_types(self):
        block = parse_time_block(
            {
                "start": "2026-04-28T09:00:00",
                "end": "2026-04-28T11:30:00",
            }
        )
        task = parse_task(
            {
                "id": 42,
                "title": "  Render perspective set  ",
                "estimateMinutes": 90,
                "dueDate": "2026-04-30",
                "priority": "low",
                "cognitiveLoad": "high",
                "status": "in_progress",
            }
        )

        self.assertEqual(block.start, datetime.fromisoformat("2026-04-28T09:00:00"))
        self.assertEqual(block.end, datetime.fromisoformat("2026-04-28T11:30:00"))
        self.assertEqual(task.id, "42")
        self.assertEqual(task.title, "Render perspective set")
        self.assertEqual(task.estimate_minutes, 90)
        self.assertEqual(task.due_date, date.fromisoformat("2026-04-30"))
        self.assertEqual(task.priority, "low")
        self.assertEqual(task.cognitive_load, "high")
        self.assertEqual(task.status, "in_progress")

    def test_scheduler_prefers_due_date_within_four_days(self):
        blocks = [
            parse_time_block(
                {
                    "start": "2026-04-28T09:00:00",
                    "end": "2026-04-28T11:00:00",
                }
            )
        ]
        tasks = [
            parse_task(
                {
                    "id": "later-high",
                    "title": "Longer horizon task",
                    "estimateMinutes": 60,
                    "dueDate": "2026-05-04",
                    "priority": "high",
                    "cognitiveLoad": "low",
                }
            ),
            parse_task(
                {
                    "id": "soon-low",
                    "title": "Closer deadline task",
                    "estimateMinutes": 60,
                    "dueDate": "2026-04-29",
                    "priority": "low",
                    "cognitiveLoad": "low",
                }
            ),
        ]

        result = schedule_tasks(blocks, tasks, now=datetime(2026, 4, 28, 8, 0))

        self.assertEqual(result["schedule"][0]["id"], "soon-low")

    def test_scheduler_prefers_priority_for_tasks_four_days_or_more_out(self):
        blocks = [
            parse_time_block(
                {
                    "start": "2026-04-28T09:00:00",
                    "end": "2026-04-28T11:00:00",
                }
            )
        ]
        tasks = [
            parse_task(
                {
                    "id": "low-earlier",
                    "title": "Lower priority earlier task",
                    "estimateMinutes": 60,
                    "dueDate": "2026-05-03",
                    "priority": "low",
                    "cognitiveLoad": "low",
                }
            ),
            parse_task(
                {
                    "id": "high-later",
                    "title": "Higher priority later task",
                    "estimateMinutes": 60,
                    "dueDate": "2026-05-05",
                    "priority": "high",
                    "cognitiveLoad": "low",
                }
            ),
        ]

        result = schedule_tasks(blocks, tasks, now=datetime(2026, 4, 28, 8, 0))

        self.assertEqual(result["schedule"][0]["id"], "high-later")

    def test_scheduler_prefers_in_progress_when_other_fields_match(self):
        blocks = [
            parse_time_block(
                {
                    "start": "2026-04-28T09:00:00",
                    "end": "2026-04-28T11:00:00",
                }
            )
        ]
        tasks = [
            parse_task(
                {
                    "id": "new-task",
                    "title": "New task",
                    "estimateMinutes": 60,
                    "dueDate": "2026-05-03",
                    "priority": "medium",
                    "cognitiveLoad": "low",
                    "status": "new",
                }
            ),
            parse_task(
                {
                    "id": "in-progress-task",
                    "title": "In progress task",
                    "estimateMinutes": 60,
                    "dueDate": "2026-05-03",
                    "priority": "medium",
                    "cognitiveLoad": "low",
                    "status": "in_progress",
                }
            ),
        ]

        result = schedule_tasks(blocks, tasks, now=datetime(2026, 4, 28, 8, 0))

        self.assertEqual(result["schedule"][0]["id"], "in-progress-task")

    def test_scheduler_marks_sub_hour_task_as_incomplete(self):
        blocks = [
            parse_time_block(
                {
                    "start": "2026-04-28T09:00:00",
                    "end": "2026-04-28T10:00:00",
                }
            )
        ]
        tasks = [
            parse_task(
                {
                    "id": "task-1",
                    "title": "Caption cleanup",
                    "estimateMinutes": 45,
                    "dueDate": "2026-04-29",
                    "priority": "low",
                    "cognitiveLoad": "low",
                }
            )
        ]

        result = schedule_tasks(blocks, tasks, now=datetime(2026, 4, 28, 8, 0))

        self.assertEqual(result["schedule"], [])
        self.assertEqual(result["unscheduled"][0]["missingMinutes"], 45)
        self.assertEqual(result["unscheduled"][0]["completionStatus"], "incomplete")

    def test_scheduler_blocks_post_due_work(self):
        blocks = [
            parse_time_block(
                {
                    "start": "2026-04-29T09:00:00",
                    "end": "2026-04-29T11:00:00",
                }
            )
        ]
        tasks = [
            parse_task(
                {
                    "id": "task-1",
                    "title": "Due before block",
                    "estimateMinutes": 60,
                    "dueDate": "2026-04-29",
                    "priority": "high",
                    "cognitiveLoad": "low",
                }
            )
        ]

        result = schedule_tasks(blocks, tasks, now=datetime(2026, 4, 28, 8, 0))

        self.assertEqual(result["schedule"], [])
        self.assertEqual(result["unscheduled"][0]["missingMinutes"], 60)

    def test_scheduler_rejects_sixty_minute_task_from_thirty_minute_slot(self):
        blocks = [
            parse_time_block(
                {
                    "start": "2026-04-28T09:00:00",
                    "end": "2026-04-28T09:30:00",
                }
            )
        ]
        tasks = [
            parse_task(
                {
                    "id": "task-1",
                    "title": "Studio prep",
                    "estimateMinutes": 60,
                    "dueDate": "2026-04-29",
                    "priority": "medium",
                    "cognitiveLoad": "medium",
                }
            )
        ]

        result = schedule_tasks(blocks, tasks, now=datetime(2026, 4, 28, 8, 0))

        self.assertEqual(result["schedule"], [])
        self.assertEqual(result["unscheduled"][0]["missingMinutes"], 60)

    def test_scheduler_evenly_splits_task_to_avoid_invalid_fragment(self):
        blocks = [
            parse_time_block(
                {
                    "start": "2026-04-28T09:00:00",
                    "end": "2026-04-28T10:15:00",
                }
            ),
            parse_time_block(
                {
                    "start": "2026-04-28T11:45:00",
                    "end": "2026-04-28T13:00:00",
                }
            ),
        ]
        tasks = [
            parse_task(
                {
                    "id": "task-1",
                    "title": "Complex writeup",
                    "estimateMinutes": 150,
                    "dueDate": "2026-04-29",
                    "priority": "medium",
                    "cognitiveLoad": "medium",
                }
            )
        ]

        result = schedule_tasks(blocks, tasks, now=datetime(2026, 4, 28, 8, 0))

        self.assertEqual(len(result["schedule"]), 1)
        self.assertEqual(
            [segment["allocatedMinutes"] for segment in result["schedule"][0]["segments"]],
            [75, 75],
        )

    def test_scheduler_uses_emergency_overload_for_urgent_task_when_required(self):
        blocks = [
            parse_time_block(
                {
                    "start": "2026-04-28T09:00:00",
                    "end": "2026-04-28T12:00:00",
                }
            )
        ]
        tasks = [
            parse_task(
                {
                    "id": "task-1",
                    "title": "Urgent deep work",
                    "estimateMinutes": 180,
                    "dueDate": "2026-04-30",
                    "priority": "high",
                    "cognitiveLoad": "high",
                }
            )
        ]

        result = schedule_tasks(blocks, tasks, now=datetime(2026, 4, 28, 8, 0))

        self.assertEqual(len(result["schedule"]), 1)
        self.assertTrue(result["schedule"][0]["usedEmergencyOverload"])
        self.assertEqual(
            [segment["allocatedMinutes"] for segment in result["schedule"][0]["segments"]],
            [180],
        )

    def test_scheduler_does_not_use_emergency_overload_for_non_urgent_task(self):
        blocks = [
            parse_time_block(
                {
                    "start": "2026-04-28T09:00:00",
                    "end": "2026-04-28T12:00:00",
                }
            )
        ]
        tasks = [
            parse_task(
                {
                    "id": "task-1",
                    "title": "Non urgent deep work",
                    "estimateMinutes": 180,
                    "dueDate": "2026-05-03",
                    "priority": "high",
                    "cognitiveLoad": "high",
                }
            )
        ]

        result = schedule_tasks(blocks, tasks, now=datetime(2026, 4, 28, 8, 0))

        self.assertEqual(result["schedule"], [])
        self.assertEqual(result["unscheduled"][0]["missingMinutes"], 180)

    def test_scheduler_enforces_high_load_recovery_gap_across_midnight(self):
        blocks = [
            parse_time_block(
                {
                    "start": "2026-04-28T21:00:00",
                    "end": "2026-04-28T22:30:00",
                }
            ),
            parse_time_block(
                {
                    "start": "2026-04-29T00:00:00",
                    "end": "2026-04-29T01:30:00",
                }
            ),
        ]
        tasks = [
            parse_task(
                {
                    "id": "task-1",
                    "title": "Deep studio work",
                    "estimateMinutes": 180,
                    "dueDate": "2026-04-30",
                    "priority": "high",
                    "cognitiveLoad": "high",
                }
            )
        ]

        result = schedule_tasks(blocks, tasks, now=datetime(2026, 4, 28, 8, 0))

        self.assertEqual(result["schedule"], [])
        self.assertEqual(result["unscheduled"][0]["missingMinutes"], 180)

    def test_scheduler_enforces_gap_between_different_high_load_tasks(self):
        blocks = [
            parse_time_block(
                {
                    "start": "2026-04-28T09:00:00",
                    "end": "2026-04-28T10:30:00",
                }
            ),
            parse_time_block(
                {
                    "start": "2026-04-28T11:30:00",
                    "end": "2026-04-28T13:00:00",
                }
            ),
            parse_time_block(
                {
                    "start": "2026-04-28T14:30:00",
                    "end": "2026-04-28T16:00:00",
                }
            ),
        ]
        tasks = [
            parse_task(
                {
                    "id": "task-a",
                    "title": "First deep task",
                    "estimateMinutes": 90,
                    "dueDate": "2026-04-30",
                    "priority": "high",
                    "cognitiveLoad": "high",
                }
            ),
            parse_task(
                {
                    "id": "task-b",
                    "title": "Second deep task",
                    "estimateMinutes": 90,
                    "dueDate": "2026-04-30",
                    "priority": "medium",
                    "cognitiveLoad": "high",
                }
            ),
        ]

        result = schedule_tasks(blocks, tasks, now=datetime(2026, 4, 28, 8, 0))

        self.assertEqual(len(result["schedule"]), 2)
        self.assertEqual(result["schedule"][0]["segments"][0]["start"], "2026-04-28T09:00:00")
        self.assertEqual(result["schedule"][1]["segments"][0]["start"], "2026-04-28T14:30:00")

    def test_schedule_endpoint_returns_expected_summary_and_completion_status(self):
        response = self.client.post(
            "/api/schedule",
            json={
                "timeBlocks": [
                    {
                        "start": "2026-04-28T09:00:00",
                        "end": "2026-04-28T10:15:00",
                    },
                    {
                        "start": "2026-04-28T11:45:00",
                        "end": "2026-04-28T13:00:00",
                    },
                ],
                "tasks": [
                    {
                        "id": "task-1",
                        "title": "Concept sketches",
                        "estimateMinutes": 150,
                        "dueDate": "2026-04-29",
                        "priority": "high",
                        "cognitiveLoad": "medium",
                    },
                    {
                        "id": "task-2",
                        "title": "Material labels",
                        "estimateMinutes": 45,
                        "dueDate": "2026-04-30",
                        "priority": "low",
                        "cognitiveLoad": "low",
                    },
                ],
            },
        )

        payload = response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["summary"]["timeBlockCount"], 2)
        self.assertEqual(payload["summary"]["taskCount"], 2)
        self.assertEqual(payload["summary"]["scheduledCount"], 1)
        self.assertEqual(payload["summary"]["completeCount"], 1)
        self.assertEqual(payload["summary"]["incompleteCount"], 1)
        self.assertEqual(payload["summary"]["unscheduledCount"], 1)
        self.assertEqual(payload["schedule"][0]["completionStatus"], "complete")
        self.assertEqual(payload["unscheduled"][0]["completionStatus"], "incomplete")


if __name__ == "__main__":
    unittest.main(verbosity=2)
