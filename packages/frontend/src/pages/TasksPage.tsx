import { useState, useEffect } from 'react'
import { api } from '../api/client'

type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE'

interface Task {
  id: string
  title: string
  description?: string | null
  status: TaskStatus
  createdAt: string
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  DONE: 'Done',
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  TODO: 'bg-gray-100 text-gray-600',
  IN_PROGRESS: 'bg-blue-50 text-blue-600',
  DONE: 'bg-green-50 text-green-600',
}

export function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)

  useEffect(() => {
    api.get<Task[]>('/api/tasks')
      .then(r => setTasks(r.data))
      .finally(() => setLoading(false))
  }, [])

  async function deleteTask(id: string) {
    await api.delete(`/api/tasks/${id}`)
    setTasks(prev => prev.filter(t => t.id !== id))
  }

  function openEdit(task: Task) {
    setEditingTask(task)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingTask(null)
  }

  function handleSaved(task: Task) {
    if (editingTask) {
      setTasks(prev => prev.map(t => t.id === task.id ? task : t))
    } else {
      setTasks(prev => [task, ...prev])
    }
    closeForm()
  }

  if (loading) {
    return <div className="text-center py-20 text-gray-300 text-sm">Loading...</div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">My Tasks</h1>
        <button
          onClick={() => setShowForm(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          + New task
        </button>
      </div>

      {showForm && (
        <TaskModal task={editingTask} onClose={closeForm} onSaved={handleSaved} />
      )}

      {tasks.length === 0 ? (
        <div className="text-center py-20 text-gray-300">
          <div className="text-4xl mb-3">✓</div>
          <p className="text-sm">No tasks yet. Create your first one!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map(task => (
            <div
              key={task.id}
              className="bg-white border border-gray-100 rounded-xl px-4 py-3 flex items-start justify-between gap-4 hover:border-gray-200 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{task.title}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[task.status]}`}>
                    {STATUS_LABELS[task.status]}
                  </span>
                </div>
                {task.description && (
                  <p className="text-sm text-gray-400 mt-0.5 truncate">{task.description}</p>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => openEdit(task)}
                  className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-50 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => deleteTask(task.id)}
                  className="text-xs text-red-300 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface TaskModalProps {
  task: Task | null
  onClose: () => void
  onSaved: (task: Task) => void
}

function TaskModal({ task, onClose, onSaved }: TaskModalProps) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'TODO')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const payload = { title, description: description || undefined, status }
      const { data } = task
        ? await api.put<Task>(`/api/tasks/${task.id}`, payload)
        : await api.post<Task>('/api/tasks', payload)
      onSaved(data)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error
      setError(msg || 'Failed to save task')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-5">{task ? 'Edit task' : 'New task'}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              autoFocus
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Status</label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value as TaskStatus)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="TODO">To Do</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="DONE">Done</option>
            </select>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-3 justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
