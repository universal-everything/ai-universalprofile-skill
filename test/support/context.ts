// Test helpers: a VerbContext bound to a temp UP_HOME and an in-memory signer
// built from a known private key (independent of the production signer backends).
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { hashMessage, keccak256, concat, serializeSignature, type Address, type Hex, type LocalAccount } from "viem";
import { sign } from "viem/accounts";
import { createContext } from "../../src/core/context.ts";
import type { Flags, Signer, VerbContext } from "../../src/core/types.ts";

export function testSigner(privateKey: Hex = generatePrivateKey()): Signer {
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    protection: { backend: "test", level: "ephemeral", unattended: true, encryptedAtRest: false, notes: ["test key"] },
    signMessage: (m) => account.signMessage({ message: m as any }),
    async signIntendedValidator(validator: Address, data: Hex) {
      const digest = keccak256(concat(["0x19", "0x00", validator, data]));
      return serializeSignature(await sign({ hash: digest, privateKey }));
    },
    signTypedData: (td) => account.signTypedData(td as any),
    signTransaction: (tx) => account.signTransaction(tx as any),
    toAccount: () => account as LocalAccount,
  };
}

export function testContext(home: string, signer?: Signer, flags: Partial<Flags> = {}): VerbContext {
  process.env.UP_HOME = home;
  const ctx = createContext({ home, flags: { json: true, dryRun: false, yes: true, ...flags } });
  if (signer) (ctx as any).signer = async () => signer;
  return ctx;
}

export { hashMessage };
