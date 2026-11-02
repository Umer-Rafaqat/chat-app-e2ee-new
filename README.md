# Chat App: Voice Calling

This document describes one-to-one and group voice calling in the existing chat application, how calls work, and which files implement them.

## What was added

- One-to-one voice calls from direct-message conversations.
- Group voice calls from group conversations, with up to 8 members including the caller.
- Group members can answer or decline independently; only members who answer receive and send call audio.
- A group-call roster shows who has joined and who is still being invited.
- Incoming and outgoing call modal with caller/recipient name and call status.
- Incoming two-tone ringtone while the recipient is deciding whether to answer.
- Answer, decline, cancel, and end-call controls.
- Mute and unmute control during an active call.
- Live mono PCM audio sent as binary WebSocket frames.
- Server-side checks that only direct-conversation participants can call, and only accepted calls can relay audio.
- Call timeout and cleanup when a participant disconnects or replaces their WebSocket connection.
- User-facing feedback for microphone permission and call errors.

Calls use the app's existing authenticated WebSocket server. This implementation does **not** use WebRTC, Socket.IO, `RTCPeerConnection`, SDP, or ICE candidates. Active call records are held in memory and are not stored in `User` or a database model.

## Call flow

1. **Start:** From a direct or group conversation, the caller selects **Call**. The browser requests microphone access with `getUserMedia({ audio: true })`, initializes Web Audio capture, then sends a `call:start` JSON event with the conversation and sample rate. Direct calls also include the recipient ID.
2. **Validate and ring:** The server checks that the caller belongs to the conversation. For group calls, it selects available, connected group members, reserves call state for the invitees, and sends each an incoming-call event. Group calls are limited to 8 conversation members, including the caller, to bound raw PCM relay bandwidth. The caller receives a ringing event. An unanswered group invitation expires after 30 seconds.
3. **Join or decline:** Each invitee independently answers or declines in the call modal. Answering requests microphone access and sends `call:accept`; the server adds that user to the joined roster and notifies the other call members. Declining removes just that invitee. When the caller ends a group call, the server ends it for everyone; other joined members can leave without ending it for the rest.
4. **Audio relay:** Each client captures 2048-sample mono `Float32` PCM frames. Binary WebSocket frames include a small sample-rate and sender-ID header. The server validates the sender and forwards each frame unchanged to the other accepted call members; unaccepted invitees do not receive audio. Each recipient schedules each speaker's frames independently for Web Audio playback.
5. **Mute and end:** **Mute** disables the local microphone track and stops audio frames from being sent. **Unmute** reenables it. Call state and microphone/audio resources are cleaned up when a member leaves, the call ends, or their socket disconnects.

## WebSocket event reference

Call signaling uses JSON WebSocket messages. Audio frames are binary WebSocket messages.

| Direction | Event | Data |
|---|---|---|
| Caller → server | `call:start` | `conversationId`, `sampleRate`; direct calls also include `receiverId` |
| Server → recipient(s) | `call:incoming` | `callId`, `conversationId`, caller details, sample rate; group calls include group name and roster |
| Server → caller | `call:ringing` | `callId`, recipient/group name, call roster |
| Recipient → server | `call:accept` | `callId`, `sampleRate` |
| Server → joined member(s) | `call:accepted` | `callId`, joined participant and current roster |
| Server → call members | `call:participant-joined`, `call:participant-left`, `call:participant-declined`, `call:participants` | `callId`, updated roster and/or participant ID |
| Participant → server | `call:reject`, `call:end` | `callId` |
| Server → affected call member(s) | `call:ended` | `callId`, `reason` |
| Either client → server | Binary frame | 16-byte sample-rate/sender-ID header followed by mono Float32 PCM samples |
| Server → other joined participant(s) | Binary frame | Same audio frame, relayed unchanged |

Other signaling failures are returned as `call:error` events.

## Updated files and responsibilities

### Frontend

- [`client/src/hooks/chat/useVoiceCall.js`](./client/src/hooks/chat/useVoiceCall.js) — direct/group call state and signaling; microphone capture; sender-tagged PCM frames; per-speaker playback; incoming ringtone; mute/unmute; cleanup and error handling.
- [`client/src/components/modals/VoiceCallModal.jsx`](./client/src/components/modals/VoiceCallModal.jsx) — direct/group call dialog, group roster, answer/decline/cancel/end, and active-call mute control.
- [`client/src/components/ChatLayout.jsx`](./client/src/components/ChatLayout.jsx) — mounts the call modal and connects its controls to the voice-call hook.
- [`client/src/pages/Chat.jsx`](./client/src/pages/Chat.jsx) — initializes the voice-call hook and passes its state and actions into the chat layout.
- [`client/src/services/websocket.js`](./client/src/services/websocket.js) — receives binary audio frames and sends binary frames over the existing WebSocket connection.
- [`client/src/context/WebSocketContext.jsx`](./client/src/context/WebSocketContext.jsx) — exposes binary sending alongside existing JSON WebSocket sending.
- [`client/src/hooks/useWebSocket.js`](./client/src/hooks/useWebSocket.js) — makes binary sending available through the existing WebSocket hook.
- [`client/src/components/chat/ChatHeader.jsx`](./client/src/components/chat/ChatHeader.jsx) — shows the **Call** action in eligible direct and group conversations.

### Backend

- [`server/websocket/call.handler.js`](./server/websocket/call.handler.js) — validates direct/group call setup and membership, handles invite responses, timeouts and departures, and relays bounded binary audio frames to accepted participants.
- [`server/websocket/connection.manager.js`](./server/websocket/connection.manager.js) — tracks active in-memory calls, invitees, and joined participants; cleans up state when sockets disconnect or are replaced.
- [`server/websocket/message.handler.js`](./server/websocket/message.handler.js) — routes JSON call events and binary audio frames to the call handler.
- [`server/websocket/connection.handler.js`](./server/websocket/connection.handler.js) — passes WebSocket binary-frame metadata to the message handler.
- [`server/websocket/websocket.server.js`](./server/websocket/websocket.server.js) — sets a maximum incoming WebSocket payload size.
- [`server/tests/e2ee.test.js`](./server/tests/e2ee.test.js) — verifies direct-call relay, group invitation/join flow, audio privacy for invitees who have not joined, and unauthorized call attempts.

## Audio, privacy, and deployment notes

- The server relays raw PCM and does not encrypt, decode, or transform the audio. **Voice calls are not end-to-end encrypted**; the relay server can access the audio data.
- This call transport is not as bandwidth-efficient or resilient as WebRTC. Network congestion or packet loss can result in audio gaps. The client limits queued playback to reduce growing latency.
- Microphone access requires a secure browser context, typically HTTPS in deployment (localhost is generally allowed during development).
- The browser may restrict ringtone playback until the user has interacted with the page. The in-app incoming-call modal remains available even if the browser blocks the sound.
- Call records are held in server memory. They are not persisted, and an application-server restart ends active calls.
- Audio is relayed only between currently connected users; there is no offline call notification or call recording.
- Group calls invite only available, connected members at call start. Members already in another call and offline members are not invited.

## Validation

Run the frontend checks:

```powershell
cd client
npm run lint
npm run build
```

Run the backend tests:

```powershell
cd server
npm test
```
