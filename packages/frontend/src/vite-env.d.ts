/// <reference types="vite/client" />

interface Window {
  ethereum?: {
    request<T = unknown>(args: { method: string; params?: unknown[] }): Promise<T>
  }
}
