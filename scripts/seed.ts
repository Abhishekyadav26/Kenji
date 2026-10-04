/**
 * Seed the Kenji test community on Sepolia.
 *
 * Usage:
 *   tsx scripts/seed.ts --dry-run        # no key needed, shows the plan
 *   SEED_PRIVATE_KEY=0x... tsx scripts/seed.ts --live   # writes on-chain
 *
 * What it does (live):
 *  1. Registers PARENT_NAME (e.g. kenji-builders.eth) via the Sepolia
 *     ETHRegistrarController if we don't own it yet (commit + reveal).
 *  2. Creates each subname in data/community.json via ENSRegistry.setSubnodeRecord.
 *  3. Sets text records (description/skills/availability) from
 *     data/seed-profiles.json via PublicResolver.setText.
 *
 * Needs Sepolia ETH for gas + parent rent. Get some from a Sepolia faucet,
 * then run with --live. Re-running is idempotent (skips records that match).
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  namehash,
  toBytes,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { normalize } from 'viem/ens';
import { ENS_ADDRESSES, PARENT_NAME, RPC_URL } from '../src/config.js';
import { fetchProfile } from '../src/ens.js';

const controllerAbi = [
  {
    type: 'function',
    name: 'makeCommitment',
    stateMutability: 'pure',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'owner', type: 'address' },
      { name: 'duration', type: 'uint256' },
      { name: 'secret', type: 'bytes32' },
      { name: 'resolver', type: 'address' },
      { name: 'data', type: 'bytes[]' },
      { name: 'reverseRecord', type: 'bool' },
      { name: 'ownerControlledFuses', type: 'uint16' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'commit',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'commitment', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'rentPrice',
    stateMutability: 'view',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'duration', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'tuple', components: [{ name: 'base', type: 'uint256' }, { name: 'premium', type: 'uint256' }] }],
  },
  {
    type: 'function',
    name: 'register',
    stateMutability: 'payable',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'owner', type: 'address' },
      { name: 'duration', type: 'uint256' },
      { name: 'secret', type: 'bytes32' },
      { name: 'resolver', type: 'address' },
      { name: 'data', type: 'bytes[]' },
      { name: 'reverseRecord', type: 'bool' },
      { name: 'ownerControlledFuses', type: 'uint16' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'available',
    stateMutability: 'view',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const registryAbi = [
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'setSubnodeRecord',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'label', type: 'bytes32' },
      { name: 'owner', type: 'address' },
      { name: 'resolver', type: 'address' },
      { name: 'ttl', type: 'uint64' },
    ],
    outputs: [],
  },
] as const;

const resolverAbi = [
  {
    type: 'function',
    name: 'setText',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    outputs: [],
  },
] as const;

type SeedProfile = { ens: string; description: string; skills: string; availability: string };

async function loadSeed(): Promise<{ names: string[]; profiles: SeedProfile[] }> {
  const community = JSON.parse(await readFile(join(process.cwd(), 'data', 'community.json'), 'utf8')) as {
    names: string[];
    parent: string;
  };
  const seed = JSON.parse(await readFile(join(process.cwd(), 'data', 'seed-profiles.json'), 'utf8')) as {
    profiles: SeedProfile[];
  };
  return { names: community.names, profiles: seed.profiles };
}

async function main() {
  const live = process.argv.includes('--live');
  const { names, profiles } = await loadSeed();
  const byEns = new Map(profiles.map((p) => [p.ens.toLowerCase(), p]));

  console.log(`Parent: ${PARENT_NAME}`);
  console.log(`Members: ${names.length}`);
  for (const n of names) {
    const p = byEns.get(n.toLowerCase());
    if (!p) console.log(`  ! ${n} has no seed profile`);
  }

  if (!live) {
    console.log('\n--dry-run plan (no transactions sent)--');
    console.log(`1. Ensure parent ${PARENT_NAME} is registered & owned by the seeder.`);
    for (const n of names) {
      const label = n.split('.')[0];
      const p = byEns.get(n.toLowerCase());
      console.log(`2. setSubnodeRecord(${PARENT_NAME}, ${label}) -> owner=seeder, resolver=PublicResolver`);
      if (p) {
        for (const k of ['description', 'skills', 'availability'] as const) {
          console.log(`3. setText(${n}, ${k}, ${(p[k] ?? '').slice(0, 60)}...)`);
        }
      }
    }
    console.log('\nRun with SEED_PRIVATE_KEY=0x... tsx scripts/seed.ts --live  (needs Sepolia ETH for gas + rent)');
    return;
  }

  const key = (process.env.SEED_PRIVATE_KEY ?? '').trim() as Address;
  if (!key || key.length < 10) {
    throw new Error('Set SEED_PRIVATE_KEY in .env to run --live');
  }
  const account = privateKeyToAccount(key.startsWith('0x') ? (key as `0x${string}`) : (`0x${key}` as `0x${string}`));
  const chain = { ...sepolia, rpcUrls: { default: { http: [RPC_URL] }, public: { http: [RPC_URL] } } };
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  const wallet = createWalletClient({ chain, transport: http(RPC_URL), account });

  console.log(`Seeder: ${account.address}`);
  const bal = await publicClient.getBalance({ address: account.address });
  console.log(`Balance: ${bal} wei`);
  if (bal === 0n) throw new Error('Seeder has no Sepolia ETH. Fund it from a Sepolia faucet first.');

  const parentNode = namehash(normalize(PARENT_NAME));
  const parentLabel = PARENT_NAME.split('.')[0]!;
  const currentOwner = (await publicClient.readContract({
    address: ENS_ADDRESSES.registry as Address,
    abi: registryAbi,
    functionName: 'owner',
    args: [parentNode],
  })) as Address;
  console.log(`Parent owner now: ${currentOwner}`);

  if (currentOwner.toLowerCase() !== account.address.toLowerCase()) {
    const available = (await publicClient.readContract({
      address: ENS_ADDRESSES.ethRegistrarController as Address,
      abi: controllerAbi,
      functionName: 'available',
      args: [parentLabel],
    })) as boolean;
    console.log(`Parent available for registration: ${available}`);
    if (!available) {
      throw new Error(`Parent ${PARENT_NAME} is owned by someone else. Set PARENT_NAME to a name you own, or use an account that owns it.`);
    }
    const duration = 31536000n; // 1 year
    const secret = keccak256(toBytes(`kenji-${Date.now()}`));
    const price = (await publicClient.readContract({
      address: ENS_ADDRESSES.ethRegistrarController as Address,
      abi: controllerAbi,
      functionName: 'rentPrice',
      args: [parentLabel, duration],
    })) as { base: bigint; premium: bigint };
    const total = price.base + price.premium;
    console.log(`Rent price: ${total} wei for 1y`);
    const commitment = (await publicClient.readContract({
      address: ENS_ADDRESSES.ethRegistrarController as Address,
      abi: controllerAbi,
      functionName: 'makeCommitment',
      args: [parentLabel, account.address, duration, secret, ENS_ADDRESSES.publicResolver as Address, [], false, 0],
    })) as `0x${string}`;
    console.log(`Committing ${commitment}...`);
    const commitHash = await wallet.writeContract({
      address: ENS_ADDRESSES.ethRegistrarController as Address,
      abi: controllerAbi,
      functionName: 'commit',
      args: [commitment],
    });
    console.log(`commit tx: ${commitHash} — waiting 70s (required reveal delay)...`);
    await new Promise((r) => setTimeout(r, 70_000));
    console.log('Registering parent...');
    const regHash = await wallet.writeContract({
      address: ENS_ADDRESSES.ethRegistrarController as Address,
      abi: controllerAbi,
      functionName: 'register',
      args: [parentLabel, account.address, duration, secret, ENS_ADDRESSES.publicResolver as Address, [], false, 0],
      value: total,
    });
    console.log(`register tx: ${regHash}`);
    await publicClient.waitForTransactionReceipt({ hash: regHash });
  } else {
    console.log('Parent already owned by seeder, skipping registration.');
  }

  for (const fullName of names) {
    const label = fullName.split('.')[0]!;
    const labelHash = keccak256(toBytes(label));
    // Registry expects labelhash keccak256(label), not of bytes; toBytes works for ascii labels.
    console.log(`\n-- ${fullName} --`);
    const node = namehash(normalize(fullName));
    const owner = (await publicClient.readContract({
      address: ENS_ADDRESSES.registry as Address,
      abi: registryAbi,
      functionName: 'owner',
      args: [node],
    })) as Address;
    if (owner.toLowerCase() !== account.address.toLowerCase()) {
      const h = await wallet.writeContract({
        address: ENS_ADDRESSES.registry as Address,
        abi: registryAbi,
        functionName: 'setSubnodeRecord',
        args: [parentNode, labelHash, account.address, ENS_ADDRESSES.publicResolver as Address, 0n],
      });
      console.log(`setSubnodeRecord tx: ${h}`);
      await publicClient.waitForTransactionReceipt({ hash: h });
    } else {
      console.log('subname already owned, skipping create');
    }
    const want = byEns.get(fullName.toLowerCase());
    if (!want) continue;
    for (const k of ['description', 'skills', 'availability'] as const) {
      const current = await fetchProfile(fullName).then((p) => (p as Record<string, string>)[k] ?? '');
      if (current === want[k]) {
        console.log(`text ${k}: up to date, skipping`);
        continue;
      }
      const h = await wallet.writeContract({
        address: ENS_ADDRESSES.publicResolver as Address,
        abi: resolverAbi,
        functionName: 'setText',
        args: [node, k, want[k] ?? ''],
      });
      console.log(`setText ${k} tx: ${h}`);
      await publicClient.waitForTransactionReceipt({ hash: h });
    }
  }
  console.log('\nDone. Run `npm run refresh` to rebuild the index from live records.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
