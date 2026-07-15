function openWalletPopup(ssoIssuer: string, params: Record<string, string>): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const callerOrigin = window.location.origin
    const qs = new URLSearchParams({ ...params, origin: callerOrigin }).toString()
    const popup = window.open(
      `${ssoIssuer}/wallet/popup?${qs}`,
      'wallet_popup',
      'width=420,height=520,left=200,top=100,noopener=no',
    )

    if (!popup) {
      reject(new Error('Popup was blocked by the browser'))
      return
    }

    const ssoOrigin = new URL(ssoIssuer).origin

    function onMessage(event: MessageEvent) {
      if (event.origin !== ssoOrigin) return
      const { type, ...data } = (event.data ?? {}) as Record<string, string>
      if (type === 'wallet_result') {
        cleanup()
        resolve(data)
      } else if (type === 'wallet_error') {
        cleanup()
        reject(new Error(data.error ?? 'Wallet operation failed'))
      }
    }

    const closedTimer = setInterval(() => {
      if (popup.closed) {
        cleanup()
        reject(new Error('Popup closed'))
      }
    }, 400)

    window.addEventListener('message', onMessage)

    function cleanup() {
      clearInterval(closedTimer)
      window.removeEventListener('message', onMessage)
    }
  })
}

export async function createWalletViaPopup(ssoIssuer: string): Promise<string> {
  const result = await openWalletPopup(ssoIssuer, { type: 'create' })
  if (!result.address) throw new Error('No wallet address in response')
  return result.address
}

export async function signMessageViaPopup(ssoIssuer: string, message: string): Promise<string> {
  const result = await openWalletPopup(ssoIssuer, { type: 'sign', message })
  if (!result.signature) throw new Error('No signature in response')
  return result.signature
}

export async function sendTransactionViaPopup(
  ssoIssuer: string,
  params: { to: string; value?: string; chainId?: number; data?: string },
): Promise<string> {
  const urlParams: Record<string, string> = {
    type: 'send',
    to: params.to,
    value: params.value ?? '0x0',
  }
  if (params.chainId != null) urlParams.chainId = String(params.chainId)
  if (params.data) urlParams.data = params.data

  const result = await openWalletPopup(ssoIssuer, urlParams)
  if (!result.hash) throw new Error('No transaction hash in response')
  return result.hash
}

// ABI encoding helpers — avoid adding ethers as a frontend dep

function padHex(hex: string, bytes = 32): string {
  return hex.replace(/^0x/, '').padStart(bytes * 2, '0')
}

export function encodeERC20Transfer(to: string, amountWei: bigint): string {
  return '0xa9059cbb' + padHex(to) + padHex(amountWei.toString(16))
}

export function encodeERC20Approve(spender: string, amountWei: bigint): string {
  return '0x095ea7b3' + padHex(spender) + padHex(amountWei.toString(16))
}

export function parseUnits(amount: string, decimals: number): bigint {
  const [int, frac = ''] = amount.split('.')
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt(int || '0') * 10n ** BigInt(decimals) + BigInt(fracPadded || '0')
}