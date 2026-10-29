/** Catalog keys for one Security Center row. */
export function securityCenterCopy(id: string, summary: string): { detail: string; remediation: string } {
  switch (id) {
    case "runtime.node":
      if (summary === "supported" || summary === "unsupported") {
        return {
          detail: "security.center.checks.runtimeNode.version",
          remediation: "security.center.checks.runtimeNode.remediation",
        };
      }
      return {
        detail: "security.center.checks.runtimeNode.unknown",
        remediation: "security.center.checks.runtimeNode.remediation",
      };
    case "runtime.update":
      switch (summary) {
        case "current":
          return {
            detail: "security.center.checks.runtimeUpdate.current",
            remediation: "security.center.checks.runtimeUpdate.remediationCurrent",
          };
        case "available":
          return {
            detail: "security.center.checks.runtimeUpdate.available",
            remediation: "security.center.checks.runtimeUpdate.remediationAvailable",
          };
        case "otherSite":
          return {
            detail: "security.center.checks.runtimeUpdate.otherSite",
            remediation: "security.center.checks.runtimeUpdate.remediationOtherSite",
          };
        default:
          return {
            detail: "security.center.checks.runtimeUpdate.unknown",
            remediation: "security.center.checks.runtimeUpdate.remediationUnknown",
          };
      }
    case "runtime.debug":
      if (summary === "productionOn") {
        return {
          detail: "security.center.checks.runtimeDebug.productionOn",
          remediation: "security.center.checks.runtimeDebug.remediation",
        };
      }
      if (summary === "developmentOn") {
        return {
          detail: "security.center.checks.runtimeDebug.developmentOn",
          remediation: "security.center.checks.runtimeDebug.remediation",
        };
      }
      return {
        detail: "security.center.checks.runtimeDebug.off",
        remediation: "security.center.checks.runtimeDebug.remediation",
      };
    case "runtime.installer":
      return summary === "open"
        ? {
            detail: "security.center.checks.runtimeInstaller.open",
            remediation: "security.center.checks.runtimeInstaller.remediation",
          }
        : {
            detail: "security.center.checks.runtimeInstaller.closed",
            remediation: "security.center.checks.runtimeInstaller.remediation",
          };
    case "accounts.mfa":
      if (summary === "partial") {
        return {
          detail: "security.center.checks.accountsMfa.partial",
          remediation: "security.center.checks.accountsMfa.remediation",
        };
      }
      if (summary === "unknown") {
        return {
          detail: "security.center.checks.accountsMfa.unknown",
          remediation: "security.center.checks.accountsMfa.remediation",
        };
      }
      return {
        detail: "security.center.checks.accountsMfa.all",
        remediation: "security.center.checks.accountsMfa.remediation",
      };
    case "accounts.sessions":
      return summary === "unknown"
        ? {
            detail: "security.center.checks.accountsSessions.unknown",
            remediation: "security.center.checks.accountsSessions.remediation",
          }
        : {
            detail: "security.center.checks.accountsSessions.known",
            remediation: "security.center.checks.accountsSessions.remediation",
          };
    case "accounts.apiKeys":
      switch (summary) {
        case "none":
          return {
            detail: "security.center.checks.accountsApiKeys.none",
            remediation: "security.center.checks.accountsApiKeys.remediation",
          };
        case "openEnded":
          return {
            detail: "security.center.checks.accountsApiKeys.openEnded",
            remediation: "security.center.checks.accountsApiKeys.remediation",
          };
        case "unknown":
          return {
            detail: "security.center.checks.accountsApiKeys.unknown",
            remediation: "security.center.checks.accountsApiKeys.remediation",
          };
        case "unavailable":
          return {
            detail: "security.center.checks.accountsApiKeys.unavailable",
            remediation: "security.center.checks.accountsApiKeys.remediationUnavailable",
          };
        default:
          return {
            detail: "security.center.checks.accountsApiKeys.expiring",
            remediation: "security.center.checks.accountsApiKeys.remediation",
          };
      }
    case "transport.cookies":
      if (summary === "insecureProduction") {
        return {
          detail: "security.center.checks.transportCookies.insecureProduction",
          remediation: "security.center.checks.transportCookies.remediation",
        };
      }
      if (summary === "development") {
        return {
          detail: "security.center.checks.transportCookies.development",
          remediation: "security.center.checks.transportCookies.remediation",
        };
      }
      return {
        detail: "security.center.checks.transportCookies.secure",
        remediation: "security.center.checks.transportCookies.remediation",
      };
    case "transport.tls":
      switch (summary) {
        case "productionHttp":
          return {
            detail: "security.center.checks.transportTls.productionHttp",
            remediation: "security.center.checks.transportTls.remediationProductionHttp",
          };
        case "developmentHttp":
          return {
            detail: "security.center.checks.transportTls.developmentHttp",
            remediation: "security.center.checks.transportTls.remediationDevelopment",
          };
        case "missing":
          return {
            detail: "security.center.checks.transportTls.missing",
            remediation: "security.center.checks.transportTls.remediationMissing",
          };
        default:
          return {
            detail: "security.center.checks.transportTls.notProbed",
            remediation: "security.center.checks.transportTls.remediationNotProbed",
          };
      }
    case "transport.proxy":
      switch (summary) {
        case "wide":
          return {
            detail: "security.center.checks.transportProxy.wide",
            remediation: "security.center.checks.transportProxy.remediationWide",
          };
        case "disabledProduction":
          return {
            detail: "security.center.checks.transportProxy.disabledProduction",
            remediation: "security.center.checks.transportProxy.remediationDisabled",
          };
        case "disabledDevelopment":
          return {
            detail: "security.center.checks.transportProxy.disabledDevelopment",
            remediation: "security.center.checks.transportProxy.remediationDevelopment",
          };
        case "otherSite":
          return {
            detail: "security.center.checks.transportProxy.otherSite",
            remediation: "security.center.checks.transportProxy.remediationOtherSite",
          };
        default:
          return {
            detail: "security.center.checks.transportProxy.bounded",
            remediation: "security.center.checks.transportProxy.remediationBounded",
          };
      }
    case "headers.policy":
      switch (summary) {
        case "critical":
          return {
            detail: "security.center.checks.headersPolicy.findings",
            remediation: "security.center.checks.headersPolicy.remediation",
          };
        case "warnings":
          return {
            detail: "security.center.checks.headersPolicy.findings",
            remediation: "security.center.checks.headersPolicy.remediation",
          };
        case "killSwitch":
          return {
            detail: "security.center.checks.headersPolicy.killSwitch",
            remediation: "security.center.checks.headersPolicy.remediationKillSwitch",
          };
        case "unavailable":
          return {
            detail: "security.center.checks.headersPolicy.unavailable",
            remediation: "security.center.checks.headersPolicy.remediationUnavailable",
          };
        case "unknown":
          return {
            detail: "security.center.checks.headersPolicy.unknown",
            remediation: "security.center.checks.headersPolicy.remediationUnknown",
          };
        default:
          return {
            detail: "security.center.checks.headersPolicy.findings",
            remediation: "security.center.checks.headersPolicy.remediation",
          };
      }
    case "extensions.integrity":
      return {
        detail: "security.center.checks.extensionsIntegrity.unavailable",
        remediation: "security.center.checks.extensionsIntegrity.remediation",
      };
    case "recovery.backup":
      return {
        detail: "security.center.checks.recoveryBackup.notVerified",
        remediation: "security.center.checks.recoveryBackup.remediation",
      };
    default:
      return { detail: "security.center.missing", remediation: "security.center.missing" };
  }
}
