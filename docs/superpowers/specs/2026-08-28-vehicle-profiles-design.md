# Vehicle Profiles Design

Date: 2026-08-28
Status: Approved
Scope: Customer vehicle profiles (backend + frontend), after the approved Authentication phase

## 1. Data Model - Vehicle

| Field | Rule |
|---|---|
| `owner` | `ObjectId` -> `User`, required, indexed |
| `registrationNumber` | Required. Normalized: trim -> uppercase -> remove spaces and hyphens -> stored value must match `/^[A-Z0-9]{4,15}$/`. `\"TN 01 AB-1234\"` -> `\"TN01AB1234\"`. Globally unique across active and archived. Immutable after creation. |
| `make` | Required, trimmed, 1-50 chars |
| `model` | Required, trimmed, 1-50 chars |
| `year` | Required integer, min 1980, max `new Date().getFullYear() + 1` (dynamic, not hard-coded) |
| `fuelType` | Enum `petrol | diesel | electric | hybrid | cng` (lpg removed) |
| `status` | Enum `active | archived`, default `active`, server-managed |
| `archivedAt` | `Date`, `null` while active; set on archive; cleared on restore |
| `activeSlot` | Integer 1-5, `null` when archived; internal, never serialized |
| `createdAt` / `updatedAt` | Timestamps |

### Indexes

```js
vehicleSchema.index({ owner: 1, createdAt: -1 });
vehicleSchema.index({ registrationNumber: 1 }, { unique: true });
vehicleSchema.index(
  { owner: 1, activeSlot: 1 },
  { unique: true, partialFilterExpression: { status: "active" } }
);
```

The compound partial index caps active vehicles at five per customer; archived rows (`activeSlot: null`) never collide. It is the concurrency arbiter - `countDocuments` is never trusted.

### Slot lifecycle

Create/restore runs a bounded loop over slots 1-5 writing with a candidate slot; on an E11000 whose key is `owner`+`activeSlot`, retry the next slot; after five misses -> exact limit 409. On E11000 whose key is `registrationNumber` -> exact duplicate 409 (never retried). Archive sets `status: "archived"`, `archivedAt: now`, `activeSlot: null` - this frees that vehicle's assigned activeSlot (not "the lowest slot"). Restore reacquires a slot via the same bounded loop with `findOneAndUpdate({ _id, owner, status: "archived", activeSlot: null }, ...)`. Documents are never deleted.
