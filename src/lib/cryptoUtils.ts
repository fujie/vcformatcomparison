import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha512'

// noble/ed25519 v2 requires explicit SHA-512
ed.etc.sha512Sync = (...msgs) => sha512(ed.etc.concatBytes(...msgs))

export interface Ed25519KeyPair {
  privateKey: Uint8Array
  publicKey: Uint8Array
}

export async function generateEd25519KeyPair(): Promise<Ed25519KeyPair> {
  const privateKey = ed.utils.randomPrivateKey()
  const publicKey = await ed.getPublicKeyAsync(privateKey)
  return { privateKey, publicKey }
}

export async function ed25519Sign(message: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
  return ed.signAsync(message, privateKey)
}

export async function ed25519Verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  return ed.verifyAsync(signature, message, publicKey)
}

export async function sha256(data: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(data)
  const buf = await crypto.subtle.digest('SHA-256', encoded)
  return new Uint8Array(buf)
}

export function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

export function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + ((4 - (str.length % 4)) % 4), '=')
  return new Uint8Array(
    atob(padded)
      .split('')
      .map((c) => c.charCodeAt(0)),
  )
}
