import { Layer } from "effect";

import { makeSshLaneConcurrency } from "../sshLaneConcurrency.ts";
import { SshLaneConcurrency } from "../Services/SshLaneConcurrency.ts";

export const SshLaneConcurrencyLive = Layer.effect(SshLaneConcurrency, makeSshLaneConcurrency());
