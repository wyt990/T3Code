import { Effect, Fiber, Stream } from "effect";

import type { WorkspaceTerminalSession } from "../workspace/Services/WorkspaceExecution.ts";
import type { PtyExitEvent, PtyProcess } from "./Services/PTY.ts";

/** Adapts an SSH workspace shell to the PtyProcess interface used by TerminalManager. */
export const createSshTerminalPtyProcess = (session: WorkspaceTerminalSession): PtyProcess => {
  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<(event: PtyExitEvent) => void>();
  let closed = false;

  const outputFiber = Effect.runFork(
    Stream.runForEach(session.output, (data) =>
      Effect.sync(() => {
        for (const listener of dataListeners) {
          listener(data);
        }
      }),
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (closed) {
            return;
          }
          closed = true;
          for (const listener of exitListeners) {
            listener({ exitCode: 0, signal: null });
          }
        }),
      ),
    ),
  );

  const exitFiber = Effect.runFork(
    session.exited.pipe(
      Effect.tap((exitCode) =>
        Effect.sync(() => {
          if (closed) {
            return;
          }
          closed = true;
          for (const listener of exitListeners) {
            listener({ exitCode, signal: null });
          }
        }),
      ),
      Effect.catch(() => Effect.void),
    ),
  );

  const cleanupFibers = () => {
    void Effect.runPromise(Fiber.interrupt(outputFiber));
    void Effect.runPromise(Fiber.interrupt(exitFiber));
  };

  return {
    pid: 0,
    write: (data) => {
      void Effect.runPromise(session.write(data)).catch(() => undefined);
    },
    resize: (cols, rows) => {
      void Effect.runPromise(session.resize(cols, rows)).catch(() => undefined);
    },
    kill: () => {
      cleanupFibers();
      void Effect.runPromise(session.close()).catch(() => undefined);
    },
    onData: (callback) => {
      dataListeners.add(callback);
      return () => {
        dataListeners.delete(callback);
      };
    },
    onExit: (callback) => {
      exitListeners.add(callback);
      return () => {
        exitListeners.delete(callback);
      };
    },
  };
};
