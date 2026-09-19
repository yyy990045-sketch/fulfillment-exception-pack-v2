import { Badge } from "../ui/badge.js";
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
  return <Badge variant={severityTone(severity)} className={className}>{severityLabel(severity)}</Badge>;
}

export function ResolutionStatusBadge({ status, className }: { status: string; className?: string }) {
  return <Badge variant={resolutionStatusTone(status)} className={className}>{resolutionStatusLabel(status)}</Badge>;
}

export function OutcomeStatusBadge({ status, className }: { status: string; className?: string }) {
  return <Badge variant={outcomeStatusTone(status)} className={className}>{outcomeStatusLabel(status)}</Badge>;
}

export function ContextStatusBadge({ status, className }: { status: string; className?: string }) {
  return <Badge variant={contextStatusTone(status)} className={className}>{contextStatusLabel(status)}</Badge>;
}
