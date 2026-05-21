import { createFileRoute } from "@tanstack/react-router";

import { SshConnectionsSettings } from "../components/settings/SshConnectionsSettings";

export const Route = createFileRoute("/settings/ssh")({
  component: SshConnectionsSettings,
});
