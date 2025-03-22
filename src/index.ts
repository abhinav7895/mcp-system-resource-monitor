import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import si from "systeminformation";
import fetch from "node-fetch";

interface CpuUsage {
  load: number;
  cores: number[];
}

interface MemoryUsage {
  total: number;
  free: number;
  used: number;
  usagePercent: number;
}

interface DiskSpace {
  total: number;
  free: number;
  used: number;
  usagePercent: number;
  mount: string;
}

interface NetworkUsage {
  rxBytes: number;
  txBytes: number;
  rxSec: number;
  txSec: number;
  interface: string;
}

interface BatteryStatus {
  hasBattery: boolean;
  percent: number;
  isCharging: boolean;
  timeRemaining: number | null;
}

interface InternetSpeed {
  downloadMbps: number;
  uploadMbps?: number;
}

// Helper functions

async function getCpuUsage(): Promise<CpuUsage> {
  try {
    const cpuData = await si.currentLoad();
    return {
      load: cpuData.currentLoad ?? 0,
      cores: cpuData.cpus.map((cpu) => cpu.load ?? 0),
    };
  } catch (error) {
    throw new Error(
      `Failed to retrieve CPU usage: ${(error as Error).message}`
    );
  }
}

async function getMemoryUsage(): Promise<MemoryUsage> {
  try {
    const memData = await si.mem();
    const total = memData.total ?? 0;
    const free = memData.free ?? 0;
    const used = memData.used ?? 0;
    return {
      total,
      free,
      used,
      usagePercent: total > 0 ? (used / total) * 100 : 0,
    };
  } catch (error) {
    throw new Error(
      `Failed to retrieve memory usage: ${(error as Error).message}`
    );
  }
}

async function getDiskSpace(): Promise<DiskSpace> {
  try {
    const diskData = await si.fsSize();
    const mainDisk = diskData.reduce((prev, curr) =>
      (curr.size ?? 0) > (prev.size ?? 0) ? curr : prev
    );
    const total = mainDisk.size ?? 0;
    const free = mainDisk.available ?? 0;
    const used = mainDisk.used ?? 0;
    return {
      total,
      free,
      used,
      usagePercent: total > 0 ? (used / total) * 100 : 0,
      mount: mainDisk.mount ?? "unknown",
    };
  } catch (error) {
    throw new Error(
      `Failed to retrieve disk space: ${(error as Error).message}`
    );
  }
}

async function getNetworkUsage(): Promise<NetworkUsage> {
  try {
    const netData = await si.networkStats();
    const activeInterface = netData.reduce((prev, curr) =>
      (curr.rx_bytes ?? 0) + (curr.tx_bytes ?? 0) >
      (prev.rx_bytes ?? 0) + (prev.tx_bytes ?? 0)
        ? curr
        : prev
    );
    return {
      rxBytes: activeInterface.rx_bytes ?? 0,
      txBytes: activeInterface.tx_bytes ?? 0,
      rxSec: activeInterface.rx_sec ?? 0,
      txSec: activeInterface.tx_sec ?? 0,
      interface: activeInterface.iface ?? "unknown",
    };
  } catch (error) {
    throw new Error(
      `Failed to retrieve network usage: ${(error as Error).message}`
    );
  }
}

async function getBatteryStatus(): Promise<BatteryStatus> {
  try {
    const batteryData = await si.battery();
    return {
      hasBattery: batteryData.hasBattery ?? false,
      percent: batteryData.percent ?? 0,
      isCharging: batteryData.isCharging ?? false,
      timeRemaining: batteryData.timeRemaining ?? null,
    };
  } catch (error) {
    throw new Error(
      `Failed to retrieve battery status: ${(error as Error).message}`
    );
  }
}

async function getInternetSpeed(): Promise<InternetSpeed> {
  try {
    console.log("Starting download speed test...");

    const testUrls = [
      `https://8n5cq3g9tjckydmy.public.blob.vercel-storage.com/testfile-0JLrYpTg7Z3ZPi7rzRHckrQPJp8KVp.txt?t=${Date.now()}`, // Vercel 10MB
      "https://speed.cloudflare.com/__down?bytes=10000000", // Cloudflare 10MB
      "https://proof.ovh.net/files/10Mb.dat", // OVH 10MB
    ];

    let downloadResults: number[] = [];

    for (let i = 0; i < testUrls.length; i++) {
      try {
        console.log(`Testing download from source ${i + 1}...`);
        const startTime = performance.now();
        const response = await fetch(testUrls[i], {
          headers: {
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
          },
        });

        if (!response.ok) {
          console.log(
            `Source ${i + 1} failed: ${response.status} ${response.statusText}`
          );
          continue;
        }

        const buffer = await response.arrayBuffer();
        const endTime = performance.now();

        const downloadTimeSec = (endTime - startTime) / 1000;
        const fileSizeBytes = buffer.byteLength;

        console.log(
          `Source ${i + 1}: File size: ${(
            fileSizeBytes /
            (1024 * 1024)
          ).toFixed(2)} MB`
        );
        const downloadSpeedBps = (fileSizeBytes * 8) / downloadTimeSec;
        const downloadMbps = downloadSpeedBps / (1024 * 1024);

        console.log(
          `Source ${i + 1}: Download speed: ${downloadMbps.toFixed(2)} Mbps`
        );
        downloadResults.push(downloadMbps);
      } catch (error) {
        console.log(`Source ${i + 1} error: ${(error as Error).message}`);
      }
    }

    const validDownloadResults = downloadResults.filter(
      (speed) => !isNaN(speed) && speed > 0
    );
    if (validDownloadResults.length === 0) {
      throw new Error("All download tests failed");
    }

    validDownloadResults.sort((a, b) => a - b);
    const medianDownloadMbps =
      validDownloadResults[Math.floor(validDownloadResults.length / 2)];
    console.log(`Median download speed: ${medianDownloadMbps.toFixed(2)} Mbps`);


    return {
      downloadMbps: parseFloat(medianDownloadMbps.toFixed(2)),
    };
  } catch (error) {
    throw new Error(
      `Failed to measure internet speed: ${(error as Error).message}`
    );
  }
}

// Create the MCP server
const server = new McpServer({
  name: "SystemResourceMonitor",
  version: "1.0.0",
});

server.resource(
  "system_resources",
  new ResourceTemplate("system://resources", { list: undefined }),
  async () => {
    const cpu = await getCpuUsage();
    const memory = await getMemoryUsage();
    const disk = await getDiskSpace();
    const network = await getNetworkUsage();
    const battery = await getBatteryStatus();
    const speed = await getInternetSpeed();
    const snapshot = `
CPU Load: ${cpu.load.toFixed(2)}% (Cores: ${cpu.cores
      .map((c) => c.toFixed(2))
      .join(", ")}%)
Memory: ${memory.usagePercent.toFixed(2)}% used (${(
      memory.used /
      1024 ** 3
    ).toFixed(2)}GB / ${(memory.total / 1024 ** 3).toFixed(2)}GB)
Disk (${disk.mount}): ${disk.usagePercent.toFixed(2)}% used (${(
      disk.used /
      1024 ** 3
    ).toFixed(2)}GB / ${(disk.total / 1024 ** 3).toFixed(2)}GB)
Network (${network.interface}): RX: ${(network.rxSec / 1024).toFixed(
      2
    )}KB/s, TX: ${(network.txSec / 1024).toFixed(2)}KB/s
Battery: ${
      battery.hasBattery
        ? `${battery.percent}%${battery.isCharging ? " (charging)" : ""}${
            battery.timeRemaining ? `, ${battery.timeRemaining} min left` : ""
          }`
        : "No battery detected"
    }
Internet Speed: Download ${speed.downloadMbps}Mbps, Upload ${
      speed.uploadMbps
    }Mbps
    `.trim();
    return {
      contents: [
        {
          uri: "system://resources",
          text: snapshot,
          mimeType: "text/plain" as const,
        },
      ],
    };
  }
);

// Tool 1: Get CPU usage
server.tool(
  "get_cpu_usage",
  "Returns the current CPU usage as a percentage, including overall load and load per core. Useful for identifying if high CPU usage is causing system slowdowns.",
  {},
  async () => {
    try {
      const cpu = await getCpuUsage();
      const text = `CPU Load: ${cpu.load.toFixed(2)}% (Cores: ${cpu.cores
        .map((c) => c.toFixed(2))
        .join(", ")}%)`;
      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error retrieving CPU usage: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool 2: Get memory usage
server.tool(
  "get_memory_usage",
  "Returns the current memory usage, including total, used, and free memory in GB, plus the percentage used. Helps diagnose memory-related performance issues.",
  {},
  async () => {
    try {
      const memory = await getMemoryUsage();
      const text = `Memory: ${memory.usagePercent.toFixed(2)}% used (${(
        memory.used /
        1024 ** 3
      ).toFixed(2)}GB / ${(memory.total / 1024 ** 3).toFixed(2)}GB)`;
      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error retrieving memory usage: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool 3: Get disk space
server.tool(
  "get_disk_space",
  "Returns the disk space usage for the largest drive, including total, used, and free space in GB, plus the percentage used. Useful for checking available storage.",
  {},
  async () => {
    try {
      const disk = await getDiskSpace();
      const text = `Disk (${disk.mount}): ${disk.usagePercent.toFixed(
        2
      )}% used (${(disk.used / 1024 ** 3).toFixed(2)}GB / ${(
        disk.total /
        1024 ** 3
      ).toFixed(2)}GB)`;
      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error retrieving disk space: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool 4: Get network usage
server.tool(
  "get_network_usage",
  "Returns current network usage for the most active interface, including received (RX) and transmitted (TX) rates in KB/s, and total data since boot in MB. Useful for monitoring bandwidth consumption.",
  {},
  async () => {
    try {
      const network = await getNetworkUsage();
      const text = `Network (${network.interface}): RX: ${(
        network.rxSec / 1024
      ).toFixed(2)}KB/s, TX: ${(network.txSec / 1024).toFixed(
        2
      )}KB/s (Total: RX ${(network.rxBytes / 1024 ** 2).toFixed(2)}MB, TX ${(
        network.txBytes /
        1024 ** 2
      ).toFixed(2)}MB)`;
      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error retrieving network usage: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool 5: Get battery status
server.tool(
  "get_battery_status",
  "Returns the current battery status, including charge percentage, charging state, and estimated time remaining (if applicable). Useful for laptops or devices to monitor power levels.",
  {},
  async () => {
    try {
      const battery = await getBatteryStatus();
      const text = battery.hasBattery
        ? `Battery: ${battery.percent}%${
            battery.isCharging ? " (charging)" : ""
          }${
            battery.timeRemaining
              ? `, ${battery.timeRemaining} min remaining`
              : ""
          }`
        : "No battery detected";
      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error retrieving battery status: ${
              (error as Error).message
            }`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool 6: Get internet speed using your uploaded file
server.tool(
  "get_internet_speed",
  "Measures and returns the current internet speed by testing download rate using a user-uploaded file and upload rate with a 1MB POST to Postman Echo, both in Mbps. Useful for diagnosing network performance issues.",
  {},
  async () => {
    try {
      const speed = await getInternetSpeed();
      const text = `Internet Speed: Download ${speed.downloadMbps}Mbps, Upload ${speed.uploadMbps}Mbps`;
      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error measuring internet speed: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }
);


// Main function to run the server
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("System Resource Monitor Server is running...");
}

main().catch((err: Error) => {
  console.error("Error running server:", err);
  process.exit(1);
});
