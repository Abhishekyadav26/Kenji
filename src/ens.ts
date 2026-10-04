import {
  createPublicClient,
  http,
  namehash,
  type Address,
  type PublicClient,
} from 'viem';
import { sepolia } from 'viem/chains';
import { normalize } from 'viem/ens';
import { ENS_ADDRESSES, PROFILE_TEXT_KEYS, RPC_URL } from './config.js';
import type { Profile } from './schemas.js';

// Minimal ABI for Resolver.text(bytes32,string) + ENS.registry resolver lookup.
const textAbi = [
  {
    type: 'function',
    name: 'text',
    stateMutability: 'view',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

const registryAbi = [
  {
    type: 'function',
    name: 'resolver',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

let _client: PublicClient | null = null;

export function publicClient(): PublicClient {
  if (!_client) {
    _client = createPublicClient({
      chain: {
        ...sepolia,
        rpcUrls: { default: { http: [RPC_URL] }, public: { http: [RPC_URL] } },
      },
      transport: http(RPC_URL),
    });
  }
  return _client;
}

export async function getResolverAddress(ensName: string): Promise<Address | null> {
  const client = publicClient();
  const node = namehash(normalize(ensName));
  try {
    const resolver = (await client.readContract({
      address: ENS_ADDRESSES.registry as Address,
      abi: registryAbi,
      functionName: 'resolver',
      args: [node],
    })) as Address;
    if (!resolver || resolver === '0x0000000000000000000000000000000000000000') return null;
    return resolver;
  } catch {
    return null;
  }
}

export async function getTextRecord(
  ensName: string,
  key: string,
): Promise<string> {
  const client = publicClient();
  const node = namehash(normalize(ensName));
  const resolver = await getResolverAddress(ensName);
  if (!resolver) return '';
  try {
    const value = (await client.readContract({
      address: resolver,
      abi: textAbi,
      functionName: 'text',
      args: [node, key],
    })) as string;
    return value ?? '';
  } catch {
    return '';
  }
}

/** Fetch one profile (bio + skills + availability) live from Sepolia ENS. */
export async function fetchProfile(ensName: string): Promise<Profile> {
  const name = normalize(ensName.trim().toLowerCase());
  const resolver = await getResolverAddress(name);
  const out: Record<string, string> = {};
  for (const key of PROFILE_TEXT_KEYS) {
    out[key] = resolver ? await getTextRecord(name, key) : '';
  }
  return {
    ens: name,
    description: (out['description'] ?? '').slice(0, 2000),
    skills: (out['skills'] ?? '').slice(0, 1000),
    availability: (out['availability'] ?? '').slice(0, 1000),
    fetchedAt: new Date().toISOString(),
    resolver: resolver ?? '',
  };
}

/** Fetch many profiles with small concurrency. */
export async function fetchProfiles(
  ensNames: string[],
  concurrency = 4,
): Promise<Profile[]> {
  const results: Profile[] = [];
  for (let i = 0; i < ensNames.length; i += concurrency) {
    const chunk = ensNames.slice(i, i + concurrency);
    const fetched = await Promise.all(chunk.map((n) => fetchProfile(n)));
    results.push(...fetched);
  }
  return results;
}
