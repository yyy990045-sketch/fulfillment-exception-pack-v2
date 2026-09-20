import { Badge, StatusDotBadge } from "../ui/badge.js";
import {
  contextStatusLabel,
  contextStatusTone,
  outcomeStatusLabel,
  outcomeStatusTone,
  resolutionStatusLabel,
  resolutionStatusTone,
  severityLabel,
  severityTone,
} from "../../lib/presentation.js";

export function SeverityBadge({ severity, className }: { severity?: string | null; className?: string }) {
  return <StatusDotBadge variant={severityTone(severity)} className={className}>{severityLabel(severity)}</StatusDotBadge>;
}

export function ResolutionStatusBadge({ status, className }: { status: string; className?: string }) {
  return <StatusDotBadge variant={resolutionStatusTone(status)} className={className}>{resolutionStatusLabel(status)}</StatusDotBadge>;
}

export function OutcomeStatusBadge({ status, className }: { status: string; className?: string }) {
  return <StatusDotBadge variant={outcomeStatusTone(status)} className={className}>{outcomeStatusLabel(status)}</StatusDotBadge>;
}

export function ContextStatusBadge({ status, className }: { status: string; className?: string }) {
  return <StatusDotBadge variant={contextStatusTone(status)} className={className}>{contextStatusLabel(status)}</StatusDotBadge>;
}
