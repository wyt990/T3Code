import type { MessageId } from "@t3tools/contracts";
import type { MutableRefObject } from "react";
import type { ChatMessage } from "../types";

export interface AttachmentPreviewPromotionInput {
  readonly serverMessages: ChatMessage[] | undefined;
  readonly attachmentPreviewHandoffByMessageId: Record<string, string[]>;
  readonly promotionInFlightRef: MutableRefObject<Record<string, true>>;
  readonly clearAttachmentPreviewHandoff: (
    messageId: MessageId,
    previewUrls?: ReadonlyArray<string>,
  ) => void;
}

export function runAttachmentPreviewPromotionEffect(
  input: AttachmentPreviewPromotionInput,
): () => void {
  const {
    serverMessages,
    attachmentPreviewHandoffByMessageId,
    promotionInFlightRef,
    clearAttachmentPreviewHandoff,
  } = input;

  if (typeof Image === "undefined" || !serverMessages || serverMessages.length === 0) {
    return () => {};
  }

  const cleanups: Array<() => void> = [];

  for (const [messageId, handoffPreviewUrls] of Object.entries(
    attachmentPreviewHandoffByMessageId,
  )) {
    if (promotionInFlightRef.current[messageId]) {
      continue;
    }

    const serverMessage = serverMessages.find(
      (message) => message.id === messageId && message.role === "user",
    );
    if (!serverMessage?.attachments || serverMessage.attachments.length === 0) {
      continue;
    }

    const serverPreviewUrls = serverMessage.attachments.flatMap((attachment) =>
      attachment.type === "image" && attachment.previewUrl ? [attachment.previewUrl] : [],
    );
    if (
      serverPreviewUrls.length === 0 ||
      serverPreviewUrls.length !== handoffPreviewUrls.length ||
      serverPreviewUrls.some((previewUrl) => previewUrl.startsWith("blob:"))
    ) {
      continue;
    }

    promotionInFlightRef.current[messageId] = true;

    let cancelled = false;
    const imageInstances: HTMLImageElement[] = [];

    const preloadServerPreviews = Promise.all(
      serverPreviewUrls.map(
        (previewUrl) =>
          new Promise<void>((resolve, reject) => {
            const image = new Image();
            imageInstances.push(image);
            const handleLoad = () => resolve();
            const handleError = () =>
              reject(new Error(`Failed to load server preview for ${messageId}.`));
            image.addEventListener("load", handleLoad, { once: true });
            image.addEventListener("error", handleError, { once: true });
            image.src = previewUrl;
          }),
      ),
    );

    void preloadServerPreviews
      .then(() => {
        if (cancelled) {
          return;
        }
        clearAttachmentPreviewHandoff(messageId as MessageId, handoffPreviewUrls);
      })
      .catch(() => {
        if (!cancelled) {
          delete promotionInFlightRef.current[messageId];
        }
      });

    cleanups.push(() => {
      cancelled = true;
      delete promotionInFlightRef.current[messageId];
      for (const image of imageInstances) {
        image.src = "";
      }
    });
  }

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}
