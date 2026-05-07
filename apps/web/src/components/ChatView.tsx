import type { ChatViewProps } from "./chatView/ChatViewProps";
import { ChatViewBody } from "./chatView/ChatViewBody";

export default function ChatView(props: ChatViewProps) {
  return <ChatViewBody {...props} />;
}
