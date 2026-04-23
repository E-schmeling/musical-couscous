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
                        "dueDate": "2026-04-25",
                        "priority": "high",
                        "cognitiveLoad": "medium",
                    }
                ],
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.get_json(),
            {"error": "At least one time block is required."},
        )

    def test_schedule_endpoint_rejects_missing_tasks(self):
        response = self.client.post(
            "/api/schedule",
            json={
                "timeBlocks": [
                    {
                        "start": "2026-04-24T09:00:00",
                        "end": "2026-04-24T11:00:00",
                    }
                ],
                "tasks": [],
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.get_json(),
            {"error": "At least one task is required."},
        )

    def test_schedule_endpoint_rejects_invalid_time_blocks(self):
        response = self.client.post(
            "/api/schedule",
            json={
                "timeBlocks": [
                    {
                        "start": "2026-04-24T11:00:00",
                        "end": "2026-04-24T09:00:00",
                    }
                ],
                "tasks": [
                    {
                        "id": "task-1",
                        "title": "Draft concept board",
                        "estimateMinutes": 60,
                        "dueDate": "2026-04-25",
                        "priority": "high",
                        "cognitiveLoad": "medium",
                    }
                ],
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.get_json(),
            {"error": "Each time block must end after it starts."},
        )

    def test_schedule_endpoint_rejects_non_positive_estimate(self):
        response = self.client.post(
            "/api/schedule",
            json={
                "timeBlocks": [
                    {
                        "start": "2026-04-24T09:00:00",
                        "end": "2026-04-24T11:00:00",
                    }
                ],
                "tasks": [
                    {
                        "id": "task-1",
                        "title": "Draft concept board",
                        "estimateMinutes": 0,
                        "dueDate": "2026-04-25",
                        "priority": "high",
                        "cognitiveLoad": "medium",
                    }
                ],
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.get_json(),
            {"error": "Each task estimate must be greater than zero."},
        )

    def test_parse_helpers_create_expected_types(self):
        block = parse_time_block(
            {
                "start": "2026-04-24T09:00:00",
                "end": "2026-04-24T11:30:00",
            }
        )
        task = parse_task(
            {
                "id": 42,
                "title": "  Render perspective set  ",
                "estimateMinutes": 90,
                "dueDate": "2026-04-26",
                "priority": "low",
                "cognitiveLoad": "high",
            }
        )

        self.assertEqual(block.start, datetime.fromisoformat("2026-04-24T09:00:00"))
        self.assertEqual(block.end, datetime.fromisoformat("2026-04-24T11:30:00"))
        self.assertEqual(task.id, "42")
        self.assertEqual(task.title, "Render perspective set")
        self.assertEqual(task.estimate_minutes, 90)
        self.assertEqual(task.due_date, date.fromisoformat("2026-04-26"))
        self.assertEqual(task.priority, "low")
        self.assertEqual(task.cognitive_load, "high")

    def test_scheduler_orders_by_due_date_then_estimate_then_title(self):
        blocks = [
            parse_time_block(
                {
                    "start": "2026-04-24T09:00:00",
                    "end": "2026-04-24T14:00:00",
                }
            )
        ]
        tasks = [
            parse_task(
                {
                    "id": "task-b",
                    "title": "Beta diagrams",
                    "estimateMinutes": 60,
                    "dueDate": "2026-04-26",
                    "priority": "medium",
                    "cognitiveLoad": "medium",
                }
            ),
            parse_task(
                {
                    "id": "task-a",
                    "title": "Alpha diagrams",
                    "estimateMinutes": 60,
                    "dueDate": "2026-04-26",
                    "priority": "medium",
                    "cognitiveLoad": "medium",
                }
            ),
            parse_task(
                {
                    "id": "task-c",
                    "title": "Urgent model edits",
                    "estimateMinutes": 120,
                    "dueDate": "2026-04-25",
                    "priority": "high",
                    "cognitiveLoad": "high",
                }
            ),
        ]

        result = schedule_tasks(blocks, tasks)

        self.assertEqual(
            [item["id"] for item in result["schedule"]],
            ["task-c", "task-a", "task-b"],
        )

    def test_scheduler_allows_short_task_in_short_slot(self):
        blocks = [
            parse_time_block(
                {
                    "start": "2026-04-24T09:00:00",
                    "end": "2026-04-24T09:45:00",
                }
            )
        ]
        tasks = [
            parse_task(
                {
                    "id": "task-1",
                    "title": "Caption cleanup",
                    "estimateMinutes": 45,
                    "dueDate": "2026-04-25",
                    "priority": "low",
                    "cognitiveLoad": "low",
                }
            )
        ]

        result = schedule_tasks(blocks, tasks)

        self.assertEqual(len(result["schedule"]), 1)
        self.assertEqual(result["schedule"][0]["segments"][0]["allocatedMinutes"], 45)
        self.assertEqual(result["unscheduled"], [])

    def test_scheduler_rejects_sixty_minute_task_from_thirty_minute_slot(self):
        blocks = [
            parse_time_block(
                {
                    "start": "2026-04-24T09:00:00",
                    "end": "2026-04-24T09:30:00",
                }
            )
        ]
        tasks = [
            parse_task(
                {
                    "id": "task-1",
                    "title": "Studio prep",
                    "estimateMinutes": 60,
                    "dueDate": "2026-04-25",
                    "priority": "medium",
                    "cognitiveLoad": "medium",
                }
            )
        ]

        result = schedule_tasks(blocks, tasks)

        self.assertEqual(result["schedule"], [])
        self.assertEqual(len(result["unscheduled"]), 1)
        self.assertEqual(result["unscheduled"][0]["missingMinutes"], 60)

    def test_schedule_endpoint_returns_expected_summary_and_segments(self):
        response = self.client.post(
            "/api/schedule",
            json={
                "timeBlocks": [
                    {
                        "start": "2026-04-24T09:00:00",
                        "end": "2026-04-24T11:00:00",
                    },
                    {
                        "start": "2026-04-24T13:00:00",
                        "end": "2026-04-24T15:00:00",
                    },
                ],
                "tasks": [
                    {
                        "id": "task-1",
                        "title": "Concept sketches",
                        "estimateMinutes": 180,
                        "dueDate": "2026-04-25",
                        "priority": "high",
                        "cognitiveLoad": "high",
                    },
                    {
                        "id": "task-2",
                        "title": "Material labels",
                        "estimateMinutes": 45,
                        "dueDate": "2026-04-26",
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
        self.assertEqual(payload["summary"]["scheduledCount"], 2)
        self.assertEqual(payload["summary"]["unscheduledCount"], 0)
        self.assertEqual(payload["summary"]["totalAvailableMinutes"], 240)
        self.assertEqual(payload["summary"]["totalPlannedMinutes"], 225)
        self.assertEqual(payload["schedule"][0]["id"], "task-1")
        self.assertEqual(len(payload["schedule"][0]["segments"]), 2)
        self.assertEqual(payload["schedule"][1]["id"], "task-2")
        self.assertEqual(payload["schedule"][1]["segments"][0]["allocatedMinutes"], 45)


if __name__ == "__main__":
    unittest.main(verbosity=2)
