import Avatar from "../chat/Avatar";

function PhoneIcon({ declined = false }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-6 w-6 ${declined ? "rotate-[135deg]" : ""}`}
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 11.19 19a19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.08 4.18 2 2 0 0 1 4.07 2h3a2 2 0 0 1 2 1.72c.12.96.35 1.9.69 2.8a2 2 0 0 1-.45 2.11L8.04 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.84.57 2.8.69A2 2 0 0 1 22 16.92Z" />
    </svg>
  );
}

function MicrophoneIcon({ muted = false }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
      {muted && <path d="m3 3 18 18" />}
    </svg>
  );
}

function VoiceCallModal({ call, onAccept, onReject, onEnd, onToggleMute }) {
  if (!call || call.status === "idle") return null;

  const isIncoming = call.status === "incoming";
  const isActive = call.status === "active";
  const isGroup = Boolean(call.isGroup);
  const isPreparing = call.status === "starting" || call.status === "accepting";
  const title = isIncoming
    ? isGroup
      ? "Incoming group call"
      : "Incoming voice call"
    : isActive
      ? isGroup
        ? "Group voice call"
        : "Voice call"
      : call.status === "outgoing"
        ? isGroup
          ? "Calling group"
          : "Calling"
        : "Connecting";
  const subtitle = isIncoming
    ? isGroup
      ? `${call.peerName || "A member"} is calling ${call.groupName || "the group"}`
      : "is calling you"
    : isActive
      ? isGroup
        ? `${call.participants?.length || 1} joined · ${call.invitees?.length || 0} ringing`
        : "Call in progress"
      : call.status === "outgoing"
        ? isGroup
          ? `Ringing ${call.invitees?.length || 0} group members…`
          : "Waiting for an answer…"
        : "Please wait…";

  return (
    <div className="modal-backdrop z-[110]">
      <section
        className="w-full max-w-sm overflow-hidden rounded-3xl border border-white/20 bg-slate-950 text-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-call-title"
      >
        <div className="flex flex-col items-center px-8 pb-8 pt-10 text-center">
          <div className="relative mb-5">
            {(isIncoming || call.status === "outgoing") && (
              <>
                <span className="absolute inset-0 animate-ping rounded-full bg-blue-400/20" />
                <span className="absolute -inset-2 animate-pulse rounded-full bg-blue-400/10" />
              </>
            )}
            <div className="relative rounded-full bg-slate-800 p-2 ring-1 ring-white/10">
              <Avatar name={call.peerName} size="lg" />
            </div>
          </div>

          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            {title}
          </p>
          <h2
            id="voice-call-title"
            className="mt-2 max-w-full truncate text-2xl font-semibold"
          >
            {isGroup ? call.groupName || call.peerName || "Group call" : call.peerName || "ChatApp user"}
          </h2>
          <p className="mt-2 text-sm text-slate-400">{subtitle}</p>

          {isIncoming && (
            <p className="mt-4 text-xs text-slate-500">
              Your device may ring while this call is waiting.
            </p>
          )}
          {isActive && (
            <p className="mt-4 max-w-xs text-xs leading-5 text-amber-300">
              Voice is relayed through the server and is not end-to-end encrypted.
            </p>
          )}
          {isGroup && isActive && call.participants?.length > 0 && (
            <div className="mt-4 flex max-w-full flex-wrap justify-center gap-2">
              {call.participants.map((participant) => (
                <span
                  key={participant.id}
                  className="max-w-[160px] truncate rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300"
                >
                  {participant.name}
                </span>
              ))}
            </div>
          )}

          <div className="mt-9 flex items-center justify-center gap-8">
            {isIncoming ? (
              <>
                <button
                  type="button"
                  onClick={onReject}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white transition hover:bg-red-500 focus:outline-none focus:ring-4 focus:ring-red-400/40"
                  aria-label="Decline call"
                >
                  <PhoneIcon declined />
                </button>
                <button
                  type="button"
                  onClick={onAccept}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white transition hover:bg-emerald-400 focus:outline-none focus:ring-4 focus:ring-emerald-300/40"
                  aria-label="Answer call"
                >
                  <PhoneIcon />
                </button>
              </>
            ) : isPreparing ? (
              <span className="rounded-full bg-slate-800 px-5 py-3 text-sm text-slate-300">
                Connecting…
              </span>
            ) : isActive ? (
              <>
                <button
                  type="button"
                  onClick={onToggleMute}
                  className={`flex h-14 w-14 items-center justify-center rounded-full transition focus:outline-none focus:ring-4 ${
                    call.muted
                      ? "bg-amber-500 text-white hover:bg-amber-400 focus:ring-amber-300/40"
                      : "bg-slate-700 text-white hover:bg-slate-600 focus:ring-slate-400/40"
                  }`}
                  aria-label={call.muted ? "Unmute microphone" : "Mute microphone"}
                  aria-pressed={Boolean(call.muted)}
                  title={call.muted ? "Unmute" : "Mute"}
                >
                  <MicrophoneIcon muted={call.muted} />
                </button>
                <button
                  type="button"
                  onClick={onEnd}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white transition hover:bg-red-500 focus:outline-none focus:ring-4 focus:ring-red-400/40"
                  aria-label="End call"
                >
                  <PhoneIcon declined />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onEnd}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white transition hover:bg-red-500 focus:outline-none focus:ring-4 focus:ring-red-400/40"
                aria-label={isActive ? "End call" : "Cancel call"}
              >
                <PhoneIcon declined />
              </button>
            )}
          </div>
          {isIncoming && (
            <div className="mt-3 flex w-full max-w-[190px] justify-between text-xs text-slate-400">
              <span>Decline</span>
              <span>Answer</span>
            </div>
          )}
          {isActive && (
            <div className="mt-3 flex w-full max-w-[190px] justify-between text-xs text-slate-400">
              <span>{call.muted ? "Unmute" : "Mute"}</span>
              <span>End call</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default VoiceCallModal;
