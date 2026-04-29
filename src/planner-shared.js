(function attachArchitecturePlanner(global) {
  const DAY_MS = 86400000;
  const MINIMUM_WORK_BLOCK_MINUTES = 60;
  const SCHEDULING_STEP_MINUTES = 15;
  const COGNITIVE_LOAD_CAP_MINUTES = {
    high: 90,
    medium: 120,
    low: 180
  };

  function getCognitiveLoadCapMinutes(cognitiveLoad) {
    return COGNITIVE_LOAD_CAP_MINUTES[cognitiveLoad] || COGNITIVE_LOAD_CAP_MINUTES.medium;
  }

  function isEmergencyOverloadEligible(dueDate) {
    if (!dueDate) {
      return false;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(`${dueDate}T00:00:00`);
    due.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((due.getTime() - today.getTime()) / DAY_MS);
    return diffDays <= 2;
  }

  function canPartitionTaskEstimate(totalMinutes, cognitiveLoad, dueDate = null) {
    const estimateMinutes = Number(totalMinutes);
    const capMinutes = getCognitiveLoadCapMinutes(cognitiveLoad);
    const allowOverload = isEmergencyOverloadEligible(dueDate);

    if (!Number.isFinite(estimateMinutes) || estimateMinutes <= 0) {
      return false;
    }
    if (estimateMinutes < MINIMUM_WORK_BLOCK_MINUTES) {
      return true;
    }
    if (estimateMinutes % SCHEDULING_STEP_MINUTES !== 0) {
      return false;
    }
    if (allowOverload) {
      return true;
    }
    if (estimateMinutes <= capMinutes) {
      return true;
    }

    for (
      let segmentMinutes = Math.min(capMinutes, estimateMinutes);
      segmentMinutes >= MINIMUM_WORK_BLOCK_MINUTES;
      segmentMinutes -= SCHEDULING_STEP_MINUTES
    ) {
      if (canPartitionTaskEstimate(estimateMinutes - segmentMinutes, cognitiveLoad, dueDate)) {
        return true;
      }
    }

    return false;
  }

  function findNearestValidEstimate(totalMinutes, cognitiveLoad, direction, dueDate = null) {
    const estimateMinutes = Number(totalMinutes);
    for (
      let candidate = estimateMinutes + (direction * SCHEDULING_STEP_MINUTES);
      candidate >= SCHEDULING_STEP_MINUTES && candidate <= 20160;
      candidate += direction * SCHEDULING_STEP_MINUTES
    ) {
      if (canPartitionTaskEstimate(candidate, cognitiveLoad, dueDate)) {
        return candidate;
      }
    }
    return null;
  }

  function getTaskEstimateValidationMessage(totalMinutes, cognitiveLoad, dueDate = null) {
    const estimateMinutes = Number(totalMinutes);
    if (!Number.isFinite(estimateMinutes) || estimateMinutes <= 0) {
      return '';
    }

    if (estimateMinutes < MINIMUM_WORK_BLOCK_MINUTES) {
      return '';
    }

    if (canPartitionTaskEstimate(estimateMinutes, cognitiveLoad, dueDate)) {
      return '';
    }

    const capMinutes = getCognitiveLoadCapMinutes(cognitiveLoad);
    const lowerOption = findNearestValidEstimate(estimateMinutes, cognitiveLoad, -1, dueDate);
    const higherOption = findNearestValidEstimate(estimateMinutes, cognitiveLoad, 1, dueDate);
    const suggestionText = [lowerOption, higherOption]
      .filter((value, index, values) => value !== null && values.indexOf(value) === index)
      .join(' or ');

    return suggestionText
      ? `A ${cognitiveLoad} load task estimated at ${estimateMinutes} minutes cannot be split into valid ${MINIMUM_WORK_BLOCK_MINUTES}-${capMinutes} minute work blocks. Try ${suggestionText} minutes or lower the cognitive load.`
      : `A ${cognitiveLoad} load task estimated at ${estimateMinutes} minutes cannot be split into valid ${MINIMUM_WORK_BLOCK_MINUTES}-${capMinutes} minute work blocks.`;
  }

  function getNextHalfHour() {
    const now = new Date();
    const next = new Date(now);
    next.setSeconds(0, 0);
    const minutes = next.getMinutes();
    next.setMinutes(minutes < 30 ? 30 : 60, 0, 0);
    return next;
  }

  function getCurrentMonday() {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const diffToMonday = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const monday = new Date(today);
    monday.setDate(diffToMonday);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }

  function normalizeAvailabilityWindow(availability, persistFn) {
    if (!availability?.startMonday) {
      return availability;
    }

    const savedStart = new Date(availability.startMonday);
    savedStart.setHours(0, 0, 0, 0);
    const currentStart = getCurrentMonday();
    const diffDays = Math.floor((currentStart.getTime() - savedStart.getTime()) / DAY_MS);

    if (diffDays <= 0) {
      return availability;
    }

    const existingSchedule = Array.isArray(availability.schedule14)
      ? availability.schedule14
      : Array.from({ length: 14 }, () => ({}));
    const shiftedSchedule = diffDays >= 14
      ? Array.from({ length: 14 }, () => ({}))
      : [
          ...existingSchedule.slice(diffDays),
          ...Array.from({ length: diffDays }, () => ({}))
        ].slice(0, 14);

    const normalized = {
      ...availability,
      startMonday: currentStart.toISOString(),
      schedule14: shiftedSchedule
    };

    if (typeof persistFn === 'function') {
      persistFn(normalized);
    }

    return normalized;
  }

  function getTimeSlots(startHour = 6, endHour = 23) {
    const slots = [];
    for (let hour = startHour; hour <= endHour; hour += 1) {
      slots.push(`${hour}:00`);
      slots.push(`${hour}:30`);
    }
    return slots;
  }

  function toIsoDateTime(date, time) {
    const [hourText, minuteText] = time.split(':');
    const nextDate = new Date(date);
    nextDate.setHours(Number(hourText), Number(minuteText), 0, 0);
    return nextDate.toISOString();
  }

  function addThirtyMinutes(date, time) {
    const [hourText, minuteText] = time.split(':');
    const next = new Date(date);
    next.setHours(Number(hourText), Number(minuteText), 0, 0);
    next.setMinutes(next.getMinutes() + 30);
    return next.toISOString();
  }

  function trimBlocksToFuture(blocks) {
    const nextHalfHour = getNextHalfHour();
    return blocks
      .map((block) => {
        const start = new Date(block.start);
        const end = new Date(block.end);
        if (end <= nextHalfHour) {
          return null;
        }

        return {
          start: (start < nextHalfHour ? nextHalfHour : start).toISOString(),
          end: end.toISOString()
        };
      })
      .filter((block) => block && new Date(block.end) > new Date(block.start));
  }

  function subtractSegmentsFromBlocks(blocks, segments) {
    return blocks.flatMap((block) => {
      let remaining = [{ start: new Date(block.start), end: new Date(block.end) }];

      segments.forEach((segment) => {
        const segStart = new Date(segment.start);
        const segEnd = new Date(segment.end);

        remaining = remaining.flatMap((part) => {
          if (segEnd <= part.start || segStart >= part.end) {
            return [part];
          }

          const nextParts = [];
          if (segStart > part.start) {
            nextParts.push({ start: part.start, end: segStart });
          }
          if (segEnd < part.end) {
            nextParts.push({ start: segEnd, end: part.end });
          }
          return nextParts;
        });
      });

      return remaining
        .filter((part) => part.end > part.start)
        .map((part) => ({
          start: part.start.toISOString(),
          end: part.end.toISOString()
        }));
    });
  }

  function clipSegmentToCutoff(segment, cutoff) {
    const start = new Date(segment.start);
    const end = new Date(segment.end);
    if (start >= cutoff) {
      return null;
    }

    const clippedEnd = end > cutoff ? cutoff : end;
    if (clippedEnd <= start) {
      return null;
    }

    return {
      ...segment,
      end: clippedEnd.toISOString(),
      allocatedMinutes: Math.max(0, Math.round((clippedEnd.getTime() - start.getTime()) / 60000))
    };
  }

  function getFixedSegmentsBeforeCutoff(schedule, cutoff) {
    return (schedule || [])
      .flatMap((task) => task.segments.map((segment) => clipSegmentToCutoff(segment, cutoff)))
      .filter(Boolean);
  }

  function buildSchedulingTasks(taskList, previousSchedule, cutoff) {
    const allocatedMinutes = new Map();

    (previousSchedule?.schedule || []).forEach((task) => {
      const spentMinutes = task.segments
        .map((segment) => clipSegmentToCutoff(segment, cutoff))
        .filter(Boolean)
        .reduce((sum, segment) => sum + Number(segment.allocatedMinutes || 0), 0);
      allocatedMinutes.set(task.id, spentMinutes);
    });

    return taskList
      .filter((task) => task.status !== 'completed')
      .map((task) => {
        const taskEstimate = Number(task.estimateMinutes);
        const remainingMinutes = Math.max(0, taskEstimate - (allocatedMinutes.get(task.id) || 0));

        return {
          ...task,
          estimateMinutes: remainingMinutes
        };
      })
      .filter((task) => task.estimateMinutes > 0);
  }

  function summarizeSchedule(schedule, unscheduled, timeBlocks, taskList) {
    const totalAvailableMinutes = timeBlocks.reduce(
      (sum, block) => sum + (new Date(block.end).getTime() - new Date(block.start).getTime()) / 60000,
      0
    );
    const completeCount = schedule.filter((task) => task.completionStatus === 'complete').length;
    const incompleteScheduledCount = schedule.filter((task) => task.completionStatus !== 'complete').length;

    return {
      timeBlockCount: timeBlocks.length,
      taskCount: taskList.length,
      scheduledCount: schedule.length,
      completeCount,
      incompleteCount: incompleteScheduledCount + unscheduled.length,
      unscheduledCount: unscheduled.length,
      totalAvailableMinutes,
      totalPlannedMinutes: taskList.reduce((sum, task) => sum + Number(task.estimateMinutes || 0), 0)
    };
  }

  function mergeScheduleHistory(previousSchedule, nextSchedule, taskList, cutoff, timeBlocks = []) {
    const taskMap = new Map(taskList.map((task) => [task.id, task]));
    const merged = new Map();
    const carriedUnscheduled = new Map();

    (previousSchedule?.schedule || []).forEach((task) => {
      const fixedSegments = task.segments
        .map((segment) => clipSegmentToCutoff(segment, cutoff))
        .filter(Boolean);
      if (!fixedSegments.length) {
        return;
      }

      merged.set(task.id, {
        id: task.id,
        title: task.title,
        estimateMinutes: taskMap.get(task.id)?.estimateMinutes ?? task.estimateMinutes,
        dueDate: taskMap.get(task.id)?.dueDate ?? task.dueDate,
        priority: taskMap.get(task.id)?.priority ?? task.priority,
        cognitiveLoad: taskMap.get(task.id)?.cognitiveLoad ?? task.cognitiveLoad,
        status: taskMap.get(task.id)?.status ?? task.status ?? 'new',
        completionStatus: task.completionStatus || 'complete',
        segments: fixedSegments
      });
    });

    (nextSchedule.schedule || []).forEach((task) => {
      const current = merged.get(task.id);
      if (current) {
        current.estimateMinutes = taskMap.get(task.id)?.estimateMinutes ?? task.estimateMinutes;
        current.dueDate = taskMap.get(task.id)?.dueDate ?? task.dueDate;
        current.priority = taskMap.get(task.id)?.priority ?? task.priority;
        current.cognitiveLoad = taskMap.get(task.id)?.cognitiveLoad ?? task.cognitiveLoad;
        current.status = taskMap.get(task.id)?.status ?? task.status ?? current.status;
        current.completionStatus = task.completionStatus || current.completionStatus || 'complete';
        current.missingMinutes = task.missingMinutes;
        current.segments = [...current.segments, ...task.segments].sort((a, b) => new Date(a.start) - new Date(b.start));
        return;
      }

      merged.set(task.id, {
        ...task,
        estimateMinutes: taskMap.get(task.id)?.estimateMinutes ?? task.estimateMinutes,
        dueDate: taskMap.get(task.id)?.dueDate ?? task.dueDate,
        priority: taskMap.get(task.id)?.priority ?? task.priority,
        cognitiveLoad: taskMap.get(task.id)?.cognitiveLoad ?? task.cognitiveLoad,
        status: taskMap.get(task.id)?.status ?? task.status ?? 'new'
      });
    });

    (nextSchedule.unscheduled || []).forEach((task) => {
      const current = merged.get(task.id);
      if (current) {
        current.completionStatus = 'incomplete';
        current.missingMinutes = task.missingMinutes;
        current.unscheduledReasonCode = task.unscheduledReasonCode;
        current.unscheduledReason = task.unscheduledReason;
        current.unscheduledDetails = task.unscheduledDetails;
        current.estimateMinutes = taskMap.get(task.id)?.estimateMinutes ?? task.estimateMinutes;
        current.dueDate = taskMap.get(task.id)?.dueDate ?? task.dueDate;
        current.priority = taskMap.get(task.id)?.priority ?? task.priority;
        current.cognitiveLoad = taskMap.get(task.id)?.cognitiveLoad ?? task.cognitiveLoad;
        current.status = taskMap.get(task.id)?.status ?? task.status ?? current.status;
        return;
      }

      carriedUnscheduled.set(task.id, {
        ...task,
        estimateMinutes: taskMap.get(task.id)?.estimateMinutes ?? task.estimateMinutes,
        dueDate: taskMap.get(task.id)?.dueDate ?? task.dueDate,
        priority: taskMap.get(task.id)?.priority ?? task.priority,
        cognitiveLoad: taskMap.get(task.id)?.cognitiveLoad ?? task.cognitiveLoad,
        status: taskMap.get(task.id)?.status ?? task.status ?? 'new',
        completionStatus: task.completionStatus || 'incomplete'
      });
    });

    const schedule = Array.from(merged.values())
      .sort((a, b) => new Date(a.segments[0].start) - new Date(b.segments[0].start));
    const unscheduled = Array.from(carriedUnscheduled.values())
      .sort((a, b) => new Date(`${a.dueDate}T00:01:00`) - new Date(`${b.dueDate}T00:01:00`));
    const summary = nextSchedule.summary || summarizeSchedule(schedule, unscheduled, timeBlocks, taskList);
    const meta = nextSchedule.meta || previousSchedule?.meta || null;

    return {
      ...nextSchedule,
      ...(meta ? { meta } : {}),
      summary,
      schedule,
      unscheduled
    };
  }

  function getScheduleHealthMessage(scheduleData) {
    const summary = scheduleData?.summary;
    if (!summary) {
      return {
        tone: 'neutral',
        message: 'No optimized plan has been generated yet.'
      };
    }
    if (summary.incompleteCount > 0) {
      return {
        tone: 'warning',
        message: `${summary.incompleteCount} task${summary.incompleteCount === 1 ? '' : 's'} cannot be fully completed before the deadline.`
      };
    }
    if ((summary.scheduledCount || 0) > 0) {
      return {
        tone: 'success',
        message: 'On track.'
      };
    }
    return {
      tone: 'neutral',
      message: 'No future work is currently scheduled.'
    };
  }

  function getSpecificWindowsReminderMessages(availability) {
    const schedule14 = Array.isArray(availability?.schedule14)
      ? availability.schedule14
      : Array.from({ length: 14 }, () => ({}));

    const hasOverridesInRange = (startIndex, length) => schedule14
      .slice(startIndex, startIndex + length)
      .some((day) => Object.values(day || {}).some(Boolean));

    const reminders = [];
    if (!hasOverridesInRange(0, 7)) {
      reminders.push('Week 1 specific windows is empty.');
    }
    if (!hasOverridesInRange(7, 7)) {
      reminders.push('Week 2 specific windows is empty.');
    }
    return reminders;
  }

  global.ArchitecturePlanner = {
    addThirtyMinutes,
    buildSchedulingTasks,
    canPartitionTaskEstimate,
    clipSegmentToCutoff,
    getCognitiveLoadCapMinutes,
    getCurrentMonday,
    getFixedSegmentsBeforeCutoff,
    getNextHalfHour,
    getScheduleHealthMessage,
    getSpecificWindowsReminderMessages,
    getTaskEstimateValidationMessage,
    getTimeSlots,
    isEmergencyOverloadEligible,
    mergeScheduleHistory,
    normalizeAvailabilityWindow,
    subtractSegmentsFromBlocks,
    summarizeSchedule,
    toIsoDateTime,
    trimBlocksToFuture
  };
}(window));
