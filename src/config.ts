import 'dotenv/config';

export const SEPOLIA_CHAIN_ID = 11155111;

export const RPC_URL =
  process.env.SEPOLIA_RPC_URL?.trim() ||
  'https://ethereum-sepolia-rpc.publicnode.com';

export const PARENT_NAME =
  process.env.PARENT_NAME?.trim() || 'kenji-builders.eth';

// ENS deployments on Sepolia (ens-contracts staging `deployments/sepolia/*.json`)
export const ENS_ADDRESSES = {
  registry: '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as const,
  universalResolver: '0x3c85752a5d47DD09D677C645Ff2A938B38fbFEbA' as const,
  publicResolver: '0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5' as const,
  ethRegistrarController:
    '0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968' as const,
  nameWrapper: '0x0635513f179D50A207757E05759CbD106d7dFcE8' as const,
} as const;

// Text-record keys we index. We deliberately use a small fixed allowlist so
// retrieval + grounding stay predictable. `description` is the bio.
export const PROFILE_TEXT_KEYS = [
  'description',
  'skills',
  'availability',
] as const;
export type ProfileTextKey = (typeof PROFILE_TEXT_KEYS)[number];

export const LLM = {
  baseUrl: process.env.OPENAI_BASE_URL?.trim() || '',
  apiKey: process.env.OPENAI_API_KEY?.trim() || '',
  model: process.env.LLM_MODEL?.trim() || 'gpt-4o-mini',
};

export function hasLlm(): boolean {
  return Boolean(LLM.apiKey && LLM.baseUrl);
}
