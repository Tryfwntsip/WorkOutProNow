import { loadEnv } from "@myoadapt/config";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_NAMESPACE,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT
} from "@opentelemetry/semantic-conventions";

let sdk: NodeSDK | undefined;

/**
 * Start OpenTelemetry tracing. MUST be called before any other import that we
 * want auto-instrumented (http, pg, fastify). Services call this from a
 * dedicated `tracing` entrypoint loaded first via `--import`.
 *
 * If no OTLP endpoint is configured the SDK still runs with auto-instrumentation
 * (spans become no-op exports), so local dev works without a collector.
 */
export function startTracing(serviceName: string): void {
  if (sdk) return;
  const env = loadEnv();

  const resource = new Resource({
    [SEMRESATTRS_SERVICE_NAME]: serviceName,
    [SEMRESATTRS_SERVICE_NAMESPACE]: env.OTEL_SERVICE_NAMESPACE,
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: env.NODE_ENV
  });

  sdk = new NodeSDK({
    resource,
    traceExporter: env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? new OTLPTraceExporter({ url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` })
      : undefined,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Logs are handled by pino; disable fs noise.
        "@opentelemetry/instrumentation-fs": { enabled: false }
      })
    ]
  });

  sdk.start();

  const shutdown = () => {
    sdk
      ?.shutdown()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
