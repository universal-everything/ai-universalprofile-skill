// Chain-test fixture (used by test/chain/{tokens,social,abi}*.test.ts):
//  - deploys a Universal Profile + LSP6 Key Manager from the bytecode fixtures,
//    grants a controller ALL_PERMISSIONS and wires the canonical URD (LSP5 bookkeeping),
//    hands ownership to the KM (two-step LSP14);
//  - registers an in-test "km" ExecTransport STUB (the real transports are built
//    separately): it builds the same payload a KM transport would (UP.execute /
//    executeBatch), asks ctx.consent with a confirmation block, honours --dry-run,
//    and sends KM.execute(payload) from the controller via the harness.
// Token/social/generic verbs are unchanged when the real transports replace it.
import { encodeAbiParameters, encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { encodeData, encodePermissions } from "@erc725/erc725.js";
import LSP6Schema from "@erc725/erc725.js/schemas/LSP6KeyManager.json" with { type: "json" };
import LSP1Schema from "@erc725/erc725.js/schemas/LSP1UniversalReceiverDelegate.json" with { type: "json" };
import { fixture, type Harness } from "../../../chain/harness.ts";
import { bundledAbi } from "../../../../src/abi/bundled.ts";
import { registerTransport, type ExecOutcome, type ExecRequest } from "../../../../src/exec/transport.ts";

export const UP_ABI = bundledAbi("UniversalProfile");
export const KM_ABI = bundledAbi("LSP6KeyManager");

const ALL_PERMISSIONS = "0x00000000000000000000000000000000000000000000000000000000007f3f7f" as Hex;

export interface ProfileFixture {
  up: Address;
  km: Address;
  controller: Address;
  deployer: Address;
  urd: Address;
}

export async function deploy(h: Harness, name: string, types: string[] = [], args: unknown[] = []): Promise<Address> {
  const f = fixture(name);
  const ctor = types.length ? encodeAbiParameters(types.map((t) => ({ type: t })), args).slice(2) : "";
  return h.deployRaw(`${f.bytecode}${ctor}` as Hex);
}

export async function setupProfile(h: Harness, controller: Address = h.accounts[1]): Promise<ProfileFixture> {
  const deployer = h.accounts[0];
  const up = await deploy(h, "UniversalProfile", ["address"], [deployer]);
  const km = await deploy(h, "LSP6KeyManager", ["address"], [up]);
  const urd = h.lsp["LSP1UniversalReceiverDelegateUP@0.14.0"];
  const enc = encodeData(
    [
      { keyName: "AddressPermissions[]", value: [controller, urd] },
      { keyName: "AddressPermissions:Permissions:<address>", dynamicKeyParts: controller, value: ALL_PERMISSIONS },
      { keyName: "AddressPermissions:Permissions:<address>", dynamicKeyParts: urd, value: encodePermissions({ REENTRANCY: true, SUPER_SETDATA: true }) },
      { keyName: "LSP1UniversalReceiverDelegate", value: urd },
    ] as any,
    [...(LSP6Schema as any[]), ...(LSP1Schema as any[])] as any,
  );
  await h.sendFrom(deployer, up, encodeFunctionData({ abi: UP_ABI, functionName: "setDataBatch", args: [enc.keys as Hex[], enc.values as Hex[]] }));
  await h.sendFrom(deployer, up, encodeFunctionData({ abi: UP_ABI, functionName: "transferOwnership", args: [km] }));
  await h.sendFrom(controller, km, encodeFunctionData({ abi: KM_ABI, functionName: "execute", args: [encodeFunctionData({ abi: UP_ABI, functionName: "acceptOwnership" })] }));
  const owner = await h.request<Hex>("eth_call", [{ to: up, data: encodeFunctionData({ abi: UP_ABI, functionName: "owner" }) }, "latest"]);
  if (getAddress(`0x${owner.slice(26)}`) !== km) throw new Error("profile setup failed: KM is not the owner");
  return { up, km, controller, deployer, urd };
}

/** Copies a contract's runtime code to a fixed (canonical) address. */
export async function placeAt(h: Harness, name: string, at: Address): Promise<Address> {
  const tmp = await deploy(h, name);
  const code = await h.request<Hex>("eth_getCode", [tmp, "latest"]);
  await h.request("hardhat_setCode", [at, code]);
  return at;
}

export interface KmStub {
  requests: ExecRequest[];
  entryCalldata: Hex[];
}

/** Registers the in-test "km" transport for `p` (see header). */
export function registerKmStub(h: Harness, p: ProfileFixture): KmStub {
  const log: KmStub = { requests: [], entryCalldata: [] };
  registerTransport({
    path: "km",
    async execute(ctx, _signer, req): Promise<ExecOutcome> {
      if (req.profile.toLowerCase() !== p.up.toLowerCase()) throw new Error(`stub only serves ${p.up}`);
      const calls = req.calls ?? [];
      const payload: Hex =
        req.payload ??
        (calls.length === 1
          ? encodeFunctionData({ abi: UP_ABI, functionName: "execute", args: [BigInt(calls[0].operation), calls[0].to, calls[0].value, calls[0].data] })
          : encodeFunctionData({ abi: UP_ABI, functionName: "executeBatch", args: [calls.map((c) => BigInt(c.operation)), calls.map((c) => c.to), calls.map((c) => c.value), calls.map((c) => c.data)] }));
      const entry = encodeFunctionData({ abi: KM_ABI, functionName: "execute", args: [payload] });
      const value = calls.reduce((s, c) => s + c.value, 0n);
      const confirmation = { actor: req.profile, controller: p.controller, keyManager: p.km, path: "km", gasPayer: `controller ${p.controller}`, description: req.description, calls: calls.map((c) => ({ ...c, value: c.value.toString() })) };
      await ctx.consent({ verb: "exec", risk: "write", chainId: req.chainId, summary: confirmation, value, target: calls[0]?.to, selector: calls[0] ? ((calls[0].data.length >= 10 ? calls[0].data.slice(0, 10) : "0x") as Hex) : undefined });
      log.requests.push(req);
      log.entryCalldata.push(entry);
      const base = { path: "km" as const, chainId: req.chainId, profile: req.profile, keyManager: p.km, gasPayer: p.controller, entryCalldata: entry, confirmation };
      if (ctx.flags.dryRun) return { ...base, status: "dry-run" };
      const { hash, receipt } = await h.sendFrom(p.controller, p.km, entry);
      return { ...base, status: "success", txHash: hash, blockNumber: BigInt(receipt.blockNumber).toString(), gasUsed: BigInt(receipt.gasUsed).toString() };
    },
  });
  return log;
}
