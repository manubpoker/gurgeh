import { Task } from './types';
import { safeRead, safeWrite, safeList } from './memory';
import { logger } from './logger';

export function listTasks(filter?: { status?: string; priority?: string }): Task[] {
  const files = safeList('/self/tasks');
  const tasks: Task[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const content = safeRead(`/self/tasks/${file}`);
    if (!content) continue;
    try {
      const task: Task = JSON.parse(content);
      if (filter?.status && task.status !== filter.status) continue;
      if (filter?.priority && task.priority !== filter.priority) continue;
      tasks.push(task);
    } catch {
      logger.warn('Failed to parse task file', { file });
    }
  }

  // Sort by priority (urgent > high > medium > low), then by creation date
  const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  tasks.sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 4;
    const pb = priorityOrder[b.priority] ?? 4;
    if (pa !== pb) return pa - pb;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return tasks;
}

export function getTask(id: string): Task | null {
  const files = safeList('/self/tasks');
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const content = safeRead(`/self/tasks/${file}`);
    if (!content) continue;
    try {
      const task: Task = JSON.parse(content);
      if (task.id === id) return task;
    } catch {
      continue;
    }
  }
  return null;
}

export function createTask(
  title: string,
  description: string,
  priority: Task['priority'],
  createdBy: Task['createdBy'],
  category?: string,
): Task {
  const id = `task-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
  const now = new Date().toISOString();

  const task: Task = {
    id,
    createdAt: now,
    updatedAt: now,
    createdBy,
    title,
    description,
    priority,
    status: createdBy === 'operator' ? 'suggested' : 'accepted',
    category,
  };

  safeWrite(`/self/tasks/${id}.json`, JSON.stringify(task, null, 2), 'overwrite');
  logger.info('Task created', { id, title, priority, createdBy });
  return task;
}

export function updateTask(id: string, updates: Partial<Pick<Task, 'title' | 'description' | 'priority' | 'status' | 'agentNotes' | 'category'>>): Task | null {
  const task = getTask(id);
  if (!task) return null;

  if (updates.title !== undefined) task.title = updates.title;
  if (updates.description !== undefined) task.description = updates.description;
  if (updates.priority !== undefined) task.priority = updates.priority;
  if (updates.status !== undefined) task.status = updates.status;
  if (updates.agentNotes !== undefined) task.agentNotes = updates.agentNotes;
  if (updates.category !== undefined) task.category = updates.category;

  task.updatedAt = new Date().toISOString();

  if (updates.status === 'completed') {
    task.completedAt = task.updatedAt;
  }

  safeWrite(`/self/tasks/${id}.json`, JSON.stringify(task, null, 2), 'overwrite');
  logger.info('Task updated', { id, updates: Object.keys(updates) });
  return task;
}

export function deleteTask(id: string): boolean {
  const task = getTask(id);
  if (!task) return false;

  // Archive by marking as completed with a note rather than deleting the file
  task.status = 'completed';
  task.updatedAt = new Date().toISOString();
  task.agentNotes = (task.agentNotes || '') + '\n[Archived by operator]';

  safeWrite(`/self/tasks/${id}.json`, JSON.stringify(task, null, 2), 'overwrite');
  logger.info('Task archived', { id });
  return true;
}
