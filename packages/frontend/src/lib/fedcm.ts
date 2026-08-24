import { api } from '../api/client'
import type { User } from '../context/AuthContext'

// FedCM (Federated Credential Management) — вход через SSO без redirect'а и без
// сторонних cookie. Браузер (а не наш JS) сам обращается к эндпоинтам IdP
// (/fedcm/config.json, /fedcm/accounts, /fedcm/assertion) и, если у пользователя
// есть активная SSO-сессия, возвращает подписанный id_token. Мы отдаём его на наш
// бэкенд (/api/auth/sso/fedcm), где он верифицируется по JWKS и обменивается на
// наш app-JWT.

export interface FedcmResult {
  token: string
  user: User
}

interface FedcmLoginOptions {
  issuer: string
  clientId: string
  // 'silent'   — молча авто-переаутентифицировать вернувшегося пользователя;
  //              никакого UI не показывается, при неуспехе — отказ без диалога.
  // 'optional' — тихий вход для вернувшихся, иначе показать выбор аккаунта (по клику).
  // 'required' — всегда показывать выбор аккаунта.
  mediation?: 'silent' | 'optional' | 'required'
  signal?: AbortSignal
}

/** Поддерживает ли браузер FedCM. */
export function isFedcmSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'IdentityCredential' in window &&
    !!navigator.credentials &&
    typeof navigator.credentials.get === 'function'
  )
}

/**
 * Запрашивает у браузера FedCM id_token и логинит пользователя на нашем бэкенде.
 * Возвращает null, если подходящего credential нет (например, в silent-режиме и
 * пользователь ещё ни разу не давал согласие). Бросает исключение при реальной
 * ошибке (пользователь отклонил диалог, сеть и т.п.) — вызывающий решает, как
 * её показать.
 */
export async function fedcmLogin(opts: FedcmLoginOptions): Promise<FedcmResult | null> {
  const { issuer, clientId, mediation = 'optional', signal } = opts

  // nonce связывает выданный токен с этим конкретным запросом — бэкенд проверит
  // совпадение, чтобы исключить повторное использование чужого токена.
  const nonce = crypto.randomUUID()

  const credential = await navigator.credentials.get({
    identity: {
      context: 'signin',
      providers: [{ configURL: `${issuer}/fedcm/config.json`, clientId, nonce }],
    },
    mediation,
    signal,
  })

  const token = (credential as IdentityCredential | null)?.token
  if (!token) return null

  const { data } = await api.post<FedcmResult>('/api/auth/sso/fedcm', { token, nonce })
  return { token: data.token, user: data.user }
}

/**
 * Пассивная (silent) попытка входа: без UI. Успешна только для вернувшегося
 * пользователя с активной SSO-сессией. Любая ошибка/отсутствие credential →
 * возвращаем null и остаёмся неавторизованными.
 */
export async function silentFedcmLogin(
  opts: Omit<FedcmLoginOptions, 'mediation'>,
): Promise<FedcmResult | null> {
  try {
    return await fedcmLogin({ ...opts, mediation: 'silent' })
  } catch {
    return null
  }
}
