// Performance Tier Auto-Configuration
// Reads hardware specs and auto-selects optimal defaults for model size, backend, threads, etc.

const os = require("os");
const fs = require("fs");
const path = require("path");

const PHYSICAL_CORE_MULTIPLIER = 0.85;

function getPhysicalCores() {
  const cpus = os.cpus();
  const logicalCores = cpus.length;
  if (logicalCores <= 1) return 1;
  const commonPhysicalCounts = [2, 4, 6, 8, 10, 12, 16, 20, 24, 32];
  const isLikelyHT = commonPhysicalCounts.some(physical => logicalCores === physical * 2);
  if (isLikelyHT) return Math.max(1, Math.floor(logicalCores * 0.5));
  return logicalCores;
}

function getTotalRamGb() {
  return Math.round((os.totalmem() / (1024 ** 3)) * 100) / 100;
}

function hasNvidiaGpu() {
  try {
    const result = require("child_process").execSync("nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits", {
      encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"]
    });
    return result.trim().length > 0;
  } catch (_) {
    return false;
  }
}

function getGpuVramGb() {
  try {
    const result = require("child_process").execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Where-Object { $_.AdapterRAM -gt 0 } | Select-Object -First 1 -ExpandProperty AdapterRAM"',
      { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    const bytes = parseInt(result, 10);
    if (!isNaN(bytes) && bytes > 0) return Math.round((bytes / (1024 ** 3)) * 100) / 100;
  } catch (_) {}
  return 0;
}

const TIER_CONFIGS = {
  low: {
    label: "Low-End",
    ram_min: 0, ram_max: 8,
    recommendedModelSize: "1-3B",
    recommendedImageSize: "512x512",
    imageSteps: 15,
    llmContextSize: 2048,
    llmGpuLayers: 0,
    llmThreads: null,
    llmQuantization: "Q4_K_M",
    enableFlashAttn: false,
    whisperModel: "tiny.en-q5_1",
    ttsVoice: "af_heart",
    maxBatchSize: 256,
    backendPreference: "cpu",
    useGpu: false,
  },
  mid: {
    label: "Mid-Range",
    ram_min: 8, ram_max: 16,
    recommendedModelSize: "7-13B",
    recommendedImageSize: "768x768",
    imageSteps: 20,
    llmContextSize: 4096,
    llmGpuLayers: -1,
    llmThreads: null,
    llmQuantization: "Q4_K_M",
    enableFlashAttn: true,
    whisperModel: "base.en-q5_1",
    ttsVoice: "af_bella",
    maxBatchSize: 512,
    backendPreference: "auto",
    useGpu: true,
  },
  high: {
    label: "High-End",
    ram_min: 16, ram_max: Infinity,
    recommendedModelSize: "30-70B",
    recommendedImageSize: "1024x1024",
    imageSteps: 30,
    llmContextSize: 8192,
    llmGpuLayers: -1,
    llmThreads: null,
    llmQuantization: "Q4_K_M",
    enableFlashAttn: true,
    whisperModel: "small.en-q5_1",
    ttsVoice: "af_nicole",
    maxBatchSize: 1024,
    backendPreference: "auto",
    useGpu: true,
  },
};

const GPU_TIER_OVERRIDES = {
  hasCuda: {
    minVram: 6,
    tier: "mid",
    backendPreference: "cuda",
  },
  hasVulkan: {
    minVram: 4,
    tier: "mid",
    backendPreference: "vulkan",
  },
};

function detectTier() {
  const ramGb = getTotalRamGb();
  const gpuVram = getGpuVramGb();
  const hasNvidia = hasNvidiaGpu();
  const physicalCores = getPhysicalCores();

  let tier = "low";
  if (ramGb >= 32 || gpuVram >= 12) {
    tier = "high";
  } else if (ramGb >= 16 || gpuVram >= 6) {
    tier = "mid";
  }

  if (hasNvidia && gpuVram >= 6) {
    tier = tier === "low" ? "mid" : tier;
  }

  return { tier, ramGb, gpuVram, hasNvidia, physicalCores };
}

function getOptimalConfig() {
  const detection = detectTier();
  const config = { ...TIER_CONFIGS[detection.tier] };
  const cores = detection.physicalCores;

  config.tier = detection.tier;
  config.llmThreads = config.useGpu ? Math.max(1, Math.floor(cores * 0.5)) : cores;
  config.imageThreads = config.useGpu ? Math.max(1, Math.floor(cores * 0.5)) : cores;
  config.speechThreads = Math.max(1, Math.min(8, Math.floor(cores * 0.5)));
  config.ramGb = detection.ramGb;
  config.gpuVram = detection.gpuVram;
  config.hasNvidia = detection.hasNvidia;
  config.physicalCores = cores;

  if (detection.hasNvidia && detection.gpuVram >= 6) {
    config.backendPreference = "cuda";
  }

  return config;
}

module.exports = {
  detectTier,
  getOptimalConfig,
  TIER_CONFIGS,
  getPhysicalCores,
  getTotalRamGb,
  hasNvidiaGpu,
  getGpuVramGb,
};
