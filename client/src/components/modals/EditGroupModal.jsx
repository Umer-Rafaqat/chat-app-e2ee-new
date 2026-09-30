import { useState } from "react";

function EditGroupModal({ group, onClose, onSave }) {
  const [name, setName] = useState(group.name || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setError("Please enter a group name.");

    try {
      setSaving(true);
      setError("");
      await onSave(group._id, trimmed);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}
    >
      <div className="modal-card">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold text-slate-900">Rename group</h2>
        </div>
        <div className="p-5">
          <label htmlFor="edit-group-name" className="field-label">Group name</label>
          <input
            id="edit-group-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && handleSave()}
            maxLength={100}
            disabled={saving}
            autoFocus
            className="field-input"
          />
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button type="button" onClick={onClose} disabled={saving} className="secondary-button">Cancel</button>
          <button type="button" onClick={handleSave} disabled={saving} className="primary-button">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default EditGroupModal;
