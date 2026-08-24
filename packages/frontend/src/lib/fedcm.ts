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
  // 'passive' (по умолчанию) — обычный фоновый режим; после того как пользователь
  //   закрыл диалог, Chrome вводит cooldown/embargo и перестаёт его показывать.
  // 'active'  — Button Mode: вызывается по явному клику, всегда показывает диалог и
  //   НЕ подчиняется этому cooldown'у. Используем для интерактивной кнопки входа.
  mode?: 'active' | 'passive'
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
  const { issuer, clientId, mediation = 'optional', mode = 'passive', signal } = opts

  // nonce связывает выданный токен с этим конкретным запросом — бэкенд проверит
  // совпадение, чтобы исключить повторное использование чужого токена.
  const nonce = crypto.randomUUID()

  const credential = await navigator.credentials.get({
    identity: {
      context: 'signin',
      mode,
      // nonce передаётся внутри params (требование Chrome 143+, top-level удаляют
      // в Chrome 145). Браузер сериализует params в JSON и шлёт на assertion-эндпоинт.
      providers: [{ configURL: `${issuer}/fedcm/config.json`, clientId, params: { nonce } }],
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
 * Бесшумный авто-релогин: без какого-либо UI. Успешен только для вернувшегося
 * пользователя, у которого есть активная SSO-сессия И ранее данное согласие
 * (browser auto-reauthn). Иначе — null. Используем на загрузке страницы, чтобы
 * seamless-вернуть пользователя без единого клика и без мигания UI.
 */
export async function silentFedcmLogin(
  opts: Omit<FedcmLoginOptions, 'mediation' | 'mode'>,
): Promise<FedcmResult | null> {
  try {
    return await fedcmLogin({ ...opts, mediation: 'silent', mode: 'passive' })
  } catch {
    return null
  }
}

/**
 * Фоновая пассивная попытка входа (mediation: 'optional', passive mode) — ОСНОВНОЙ
 * путь входа. Браузер сам делает auto-reauthn либо показывает свой нативный
 * account-chooser поверх страницы; нам не нужна собственная кнопка. Любая ошибка
 * или отказ пользователя → null (тихо остаёмся на /login, где есть кнопка-резерв).
 * Не подходит для вызова без предшествующего passive-показа только в случае
 * embargo — тогда выручает active-режим кнопки.
 */
export async function passiveFedcmLogin(
  opts: Omit<FedcmLoginOptions, 'mediation' | 'mode'>,
): Promise<FedcmResult | null> {
  try {
    return await fedcmLogin({ ...opts, mediation: 'optional', mode: 'passive' })
  } catch {
    return null
  }
}
