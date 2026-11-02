import { useCallback, useEffect, useRef, useState } from "react";
import useWebSocket from "../useWebSocket";
import { useWebSocketContext } from "../useWebSocketContext";

const AUDIO_FRAME_SIZE = 2048;
const INITIAL_PLAYBACK_LEAD_SECONDS = 0.04;
const AUDIO_HEADER_BYTES = 16;

function getId(value) {
  if (!value) return "";
  if (typeof value === "object") return String(value._id || value.id || "");
  return String(value);
}

export default function useVoiceCall({
  activeConversation,
  connectionStatus,
  currentUserId,
}) {
  const [call, setCall] = useState({
    status: "idle",
    callId: null,
    conversationId: null,
    peerId: null,
    peerName: "",
    peerSampleRate: null,
    muted: false,
    error: "",
    endReason: "",
  });
  const callRef = useRef(call);
  const audioRef = useRef(null);
  const { sendMessage, sendBinary } = useWebSocketContext();

  callRef.current = call;

  const updateCall = useCallback((update) => {
    setCall((previous) => {
      const next = typeof update === "function" ? update(previous) : update;
      callRef.current = next;
      return next;
    });
  }, []);

  const cleanupAudio = useCallback(() => {
    const audio = audioRef.current;
    audioRef.current = null;
    if (!audio) return;

    audio.processor.onaudioprocess = null;
    audio.processor.disconnect();
    audio.source.disconnect();
    audio.stream.getTracks().forEach((track) => track.stop());
    if (audio.context.state !== "closed") {
      audio.context.close().catch((error) => {
        console.error("Failed to close voice audio context:", error);
      });
    }
  }, []);

  const initializeAudio = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone access is not available in this browser.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    let context;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        throw new Error("Web Audio is not available in this browser.");
      }

      context = new AudioContext();
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(AUDIO_FRAME_SIZE, 1, 1);
      const audio = {
        stream,
        context,
        source,
        processor,
        playbackByUser: new Map(),
      };

      processor.onaudioprocess = (event) => {
        event.outputBuffer.getChannelData(0).fill(0);
        if (!stream.getAudioTracks().some((track) => track.enabled)) return;
        const samples = event.inputBuffer.getChannelData(0);
        const pcm = new Float32Array(samples.length);
        pcm.set(samples);
        const frame = new Uint8Array(AUDIO_HEADER_BYTES + pcm.byteLength);
        const header = new DataView(frame.buffer);
        header.setUint32(0, context.sampleRate, true);
        for (let index = 0; index < 12; index += 1) {
          frame[4 + index] = Number.parseInt(
            String(currentUserId).slice(index * 2, index * 2 + 2),
            16,
          );
        }
        frame.set(new Uint8Array(pcm.buffer), AUDIO_HEADER_BYTES);
        sendBinary(frame.buffer);
      };
      source.connect(processor);
      processor.connect(context.destination);
      audioRef.current = audio;
      return context.sampleRate;
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      if (context && context.state !== "closed") {
        context.close().catch((closeError) => {
          console.error("Failed to close voice audio context:", closeError);
        });
      }
      throw error;
    }
  }, [currentUserId, sendBinary]);

  const playAudioFrame = useCallback((arrayBuffer) => {
    const audio = audioRef.current;
    if (
      !audio ||
      callRef.current.status !== "active" ||
      arrayBuffer.byteLength < AUDIO_HEADER_BYTES + 4 ||
      (arrayBuffer.byteLength - AUDIO_HEADER_BYTES) % 4
    ) {
      return;
    }

    const header = new DataView(arrayBuffer);
    const sampleRate = header.getUint32(0, true);
    const speakerId = Array.from(
      new Uint8Array(arrayBuffer, 4, 12),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const samples = new Float32Array(
      arrayBuffer.slice(AUDIO_HEADER_BYTES),
    );
    if (!samples.length) return;

    if (!/^[a-f\d]{24}$/i.test(speakerId) || sampleRate < 8000 || sampleRate > 96000) {
      return;
    }

    const buffer = audio.context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);

    const source = audio.context.createBufferSource();
    source.buffer = buffer;
    source.connect(audio.context.destination);
    let playback = audio.playbackByUser.get(speakerId);
    if (!playback) {
      playback = { nextPlayTime: 0, sources: new Set() };
      audio.playbackByUser.set(speakerId, playback);
    }
    const now = audio.context.currentTime;
    if (playback.nextPlayTime - now > 0.25) {
      playback.sources.forEach((queuedSource) => {
        queuedSource.stop();
        queuedSource.disconnect();
      });
      playback.sources.clear();
      playback.nextPlayTime = now;
    }
    const startAt = Math.max(
      now + INITIAL_PLAYBACK_LEAD_SECONDS,
      playback.nextPlayTime,
    );
    playback.sources.add(source);
    source.onended = () => {
      source.disconnect();
      playback.sources.delete(source);
    };
    source.start(startAt);
    playback.nextPlayTime = startAt + buffer.duration;
  }, []);

  const handleEvent = useCallback((event) => {
    if (event.type === "call:audio") {
      playAudioFrame(event.data);
      return;
    }

    if (event.type === "call:incoming") {
      updateCall({
        status: "incoming",
        callId: event.data.callId,
        conversationId: event.data.conversationId,
        peerId: event.data.callerId,
        peerName: event.data.callerName || "Unknown caller",
        peerSampleRate: event.data.sampleRate,
        isGroup: Boolean(event.data.isGroup),
        groupName: event.data.groupName || "",
        participants: event.data.participants || [],
        invitees: event.data.invitees || [],
        muted: false,
        error: "",
        endReason: "",
      });
      return;
    }

    if (event.type === "call:ringing") {
      updateCall((previous) => ({
        ...previous,
        status: "outgoing",
        callId: event.data.callId,
        peerId: event.data.receiverId,
        peerName: event.data.receiverName || previous.peerName,
        isGroup: Boolean(event.data.isGroup),
        groupName: event.data.receiverName || previous.groupName,
        participants: event.data.participants || previous.participants,
        invitees: event.data.invitees || previous.invitees,
        error: "",
      }));
      return;
    }

    if (event.type === "call:accepted") {
      updateCall((previous) => ({
        ...previous,
        status: "active",
        callId: event.data.callId,
        peerId: event.data.peerId,
        peerSampleRate: event.data.sampleRate,
        isGroup: Boolean(event.data.isGroup),
        participants: event.data.participants || previous.participants,
        invitees: event.data.invitees || [],
        error: "",
      }));
      return;
    }

    if (
      event.type === "call:participant-left" ||
      event.type === "call:participant-declined" ||
      event.type === "call:participant-joined" ||
      event.type === "call:participants"
    ) {
      updateCall((previous) => ({
        ...previous,
        participants:
          event.data.participants ||
          (event.type === "call:participant-left"
            ? previous.participants.filter(
                (participant) =>
                  String(participant.id) !== String(event.data.participantId),
              )
            : previous.participants),
        invitees:
          event.data.invitees ||
          (event.type === "call:participant-left"
            ? previous.invitees.filter(
                (invitee) =>
                  String(invitee.id) !== String(event.data.participantId),
              )
            : previous.invitees),
      }));
      return;
    }

    if (event.type === "call:ended") {
      const current = callRef.current;
      if (current.callId && current.callId !== event.data.callId) return;
      cleanupAudio();
      updateCall({
        status: "idle",
        callId: null,
        conversationId: null,
        peerId: null,
        peerName: "",
        peerSampleRate: null,
        error: "",
        endReason: event.data.reason || "ended",
      });
      return;
    }

    if (event.type === "call:error") {
      cleanupAudio();
      updateCall((previous) => ({
        ...previous,
        status: "idle",
        callId: null,
        error: event.data?.message || "The call could not be completed.",
      }));
    }
  }, [cleanupAudio, playAudioFrame, updateCall]);

  useWebSocket(handleEvent);

  const startCall = useCallback(async () => {
    const conversation = activeConversation;
    if (!conversation || connectionStatus !== "connected") {
      return;
    }

    const receiver = conversation.isGroup
      ? null
      : conversation.participants?.find(
          (participant) => getId(participant) !== String(currentUserId),
        );
    const receiverId = getId(receiver);
    if (!conversation.isGroup && !receiverId) {
      updateCall((previous) => ({
        ...previous,
        error: "Could not find the other participant in this conversation.",
      }));
      return;
    }

    updateCall({
      status: "starting",
      callId: null,
      conversationId: String(conversation._id),
      peerId: receiverId,
      peerName: conversation.isGroup
        ? conversation.name || "Group call"
        : receiver?.name || "User",
      peerSampleRate: null,
      isGroup: Boolean(conversation.isGroup),
      groupName: conversation.isGroup
        ? conversation.name || "Group call"
        : "",
      participants: [],
      invitees: [],
      muted: false,
      error: "",
      endReason: "",
    });

    try {
      const sampleRate = await initializeAudio();
      const sent = sendMessage(
        String(conversation._id),
        conversation.isGroup ? { sampleRate } : { receiverId, sampleRate },
        "call:start",
      );
      if (!sent) throw new Error("WebSocket is not connected.");
    } catch (error) {
      cleanupAudio();
      updateCall({
        status: "idle",
        callId: null,
        conversationId: null,
        peerId: null,
        peerName: "",
        peerSampleRate: null,
        error:
          error.name === "NotAllowedError" || error.name === "PermissionDeniedError"
            ? "Microphone permission was denied. Allow microphone access to call."
            : error.message || "Unable to start a voice call.",
        endReason: "",
      });
    }
  }, [
    activeConversation,
    cleanupAudio,
    connectionStatus,
    currentUserId,
    initializeAudio,
    sendMessage,
    updateCall,
  ]);

  const acceptCall = useCallback(async () => {
    const current = callRef.current;
    if (current.status !== "incoming") return;
    updateCall((previous) => ({ ...previous, status: "accepting", error: "" }));

    try {
      const sampleRate = await initializeAudio();
      if (!sendMessage(current.conversationId, {
        callId: current.callId,
        sampleRate,
      }, "call:accept")) {
        throw new Error("WebSocket is not connected.");
      }
    } catch (error) {
      cleanupAudio();
      updateCall((previous) => ({
        ...previous,
        status: "incoming",
        error:
          error.name === "NotAllowedError" || error.name === "PermissionDeniedError"
            ? "Microphone permission was denied. Allow access to answer the call."
            : error.message || "Unable to answer the call.",
      }));
    }
  }, [cleanupAudio, initializeAudio, sendMessage, updateCall]);

  const endCall = useCallback((type = "call:end") => {
    const current = callRef.current;
    if (current.callId) {
      sendMessage(current.conversationId, { callId: current.callId }, type);
    }
    cleanupAudio();
    updateCall({
      status: "idle",
      callId: null,
      conversationId: null,
      peerId: null,
      peerName: "",
      peerSampleRate: null,
      muted: false,
      error: "",
      endReason: type === "call:reject" ? "declined" : "ended",
    });
  }, [cleanupAudio, sendMessage, updateCall]);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || callRef.current.status !== "active") return;

    const muted = !callRef.current.muted;
    audio.stream.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    updateCall((previous) => ({ ...previous, muted }));
  }, [updateCall]);

  const clearCallError = useCallback(() => {
    updateCall((previous) => ({ ...previous, error: "" }));
  }, [updateCall]);

  useEffect(() => {
    if (call.status !== "incoming") return undefined;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return undefined;

    const context = new AudioContext();
    const gain = context.createGain();
    const firstTone = context.createOscillator();
    const secondTone = context.createOscillator();
    gain.gain.value = 0;
    firstTone.frequency.value = 440;
    secondTone.frequency.value = 480;
    firstTone.connect(gain);
    secondTone.connect(gain);
    gain.connect(context.destination);
    firstTone.start();
    secondTone.start();

    const ring = () => {
      const now = context.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.03);
      gain.gain.setValueAtTime(0.08, now + 0.25);
      gain.gain.linearRampToValueAtTime(0, now + 0.32);
      gain.gain.setValueAtTime(0, now + 0.48);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.51);
      gain.gain.setValueAtTime(0.08, now + 0.73);
      gain.gain.linearRampToValueAtTime(0, now + 0.8);
    };

    ring();
    const intervalId = window.setInterval(ring, 1800);
    context.resume().catch((error) => {
      console.warn("Browser could not play the incoming call ringtone:", error);
    });

    return () => {
      window.clearInterval(intervalId);
      firstTone.stop();
      secondTone.stop();
      firstTone.disconnect();
      secondTone.disconnect();
      gain.disconnect();
      if (context.state !== "closed") {
        context.close().catch((error) => {
          console.error("Failed to close ringtone audio context:", error);
        });
      }
    };
  }, [call.status]);

  useEffect(
    () => () => {
      const current = callRef.current;
      if (current.callId) {
        sendMessage(current.conversationId, { callId: current.callId }, "call:end");
      }
      cleanupAudio();
    },
    [cleanupAudio, sendMessage],
  );

  return {
    call,
    startCall,
    acceptCall,
    toggleMute,
    rejectCall: () => endCall("call:reject"),
    endCall: () => endCall("call:end"),
    clearCallError,
  };
}
