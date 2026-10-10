// Test-only in-process EVM (EDR). Not part of the shipped skill.
import { defineConfig } from "hardhat/config";

export default defineConfig({
  networks: {
    default: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 31337,
      allowUnlimitedContractSize: true,
    },
  },
});
