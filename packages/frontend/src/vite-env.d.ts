/// <reference types="vite/client" />

interface Window {
  ethereum?: {
    request<T = unknown>(args: { method: string; params?: unknown[] }): Promise<T>
  }
  // Present only in browsers that support FedCM. Used as a feature-detection flag.
  IdentityCredential?: unknown
}

// --- FedCM (Federated Credential Management) типы ---
// Стандартная lib.dom.d.ts пока не описывает опцию `identity` у credentials.get,
// поэтому дополняем встроенные интерфейсы через declaration merging.

interface IdentityProviderConfig {
  configURL: string
  clientId: string
  nonce?: string
  loginHint?: string
}

interface IdentityCredentialRequestOptions {
  context?: 'signin' | 'signup' | 'use' | 'continue'
  providers: IdentityProviderConfig[]
  // Button Mode API: 'active' открывает FedCM-диалог по явному действию пользователя
  // и НЕ подчиняется cooldown/embargo после закрытия диалога (в отличие от 'passive').
  mode?: 'active' | 'passive'
}

interface CredentialRequestOptions {
  identity?: IdentityCredentialRequestOptions
}

interface IdentityCredential extends Credential {
  readonly token?: string
}
