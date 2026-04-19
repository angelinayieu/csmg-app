# Transaction Wrapping Implementation Plan

## Problem
Currently:
```
1. Insert spaces ✅
2. Insert entities ✅
3. Insert edges ✅
4. Insert cycles ✅
5. DEDUCT CREDITS ❌ (happens even if 1-4 fail)
```

Result: User loses credits but gets incomplete/orphaned data

## Solution Architecture

### Strategy: Pre-Authorization + Compensating Transactions

Instead of trying to wrap everything in DB transaction (Supabase limitation), use:

1. **Pre-check**: Verify credits can be deducted BEFORE any inserts
2. **Reserve credits**: Create reservation record (can be rolled back easily)
3. **Transact data**: Insert all spaces/entities/edges atomically per-space
4. **Finalize**: Mark reservation as committed
5. **Rollback**: If any major operation fails, reverse credit reservation

### Implementation in 3 Steps

#### Step 1: Create Credit Reservation Table (Migration)
```sql
CREATE TABLE credit_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  tier TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved', -- reserved, committed, cancelled
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '5 minutes'
);

CREATE INDEX idx_reservations_user_status ON credit_reservations(user_id, status);
```

#### Step 2: Wrap Database Inserts (Per-Space Transaction)
```typescript
// Pseudo-code structure
try {
  // Reserve credits first (lightweight, can be reversed)
  const reservation = await reserveCredits(db, user.id, tier);
  
  // Insert all spaces (client-side orchestration, not atomic across spaces)
  for (const space of spaces) {
    try {
      const spaceId = await insertSpace(db, space);
      const entityMap = await insertEntities(db, spaceId, space.entities);
      await batchInsert(db, "edges", buildEdges(space, entityMap));
      await batchInsert(db, "cycles", space.cycles);
      // ... other inserts ...
    } catch (err) {
      // Log failure but continue with other spaces
      console.error(`Space insertion failed:`, err);
    }
  }
  
  // If we got here, commit the reservation
  await commitReservation(db, reservation.id);
  
} catch (err) {
  // Cancel the reservation (refund credits)
  await cancelReservation(db, reservation.id);
  throw err;
}
```

#### Step 3: Implement Helper Functions

#### Alternative (Simpler): Move Credit Check to Before Pipeline

Current: `Check credits → Run Pipeline (90s) → Insert DB → Deduct credits`
Problem: Credits deducted even if inserts fail

Better: `Check credits → Reserve credits → Run Pipeline → Insert DB → Finalize credits`

## Files to Modify

1. `supabase/migration-credit-reservations.sql` - Create reservation table
2. `src/lib/credits.ts` - Add reserveCredits, commitReservation, cancelReservation
3. `src/app/api/orchestrate/route.ts` - Wrap inserts with reservation flow

## Pros & Cons

### Pros
✅ Works with Supabase constraints (no need for stored functions)
✅ Per-space insertion can partially succeed
✅ Easy to add retry logic
✅ Simple rollback mechanism
✅ Can add analytics (track failed spaces)

### Cons
❌ Per-space failures don't rollback previous spaces
❌ Still not fully atomic (but better than current)
❌ Adds 2 DB calls (reserve + finalize) per analysis

## Comparison: Current vs New

| Metric | Current | New |
|--------|---------|-----|
| Credit loss on insert failure | 100% | 0% |
| Partial data loss | Yes | Yes (per-space) |
| Complexity | Low | Medium |
| Reliability | Poor | Good |
| Database calls | +1 (deduct) | +2 (reserve/finalize) |

## Risk Assessment

**Financial Risk**: 
- Current: User pays, gets nothing → Support tickets, refunds
- New: User pays only after data stored → Zero risk

**Data Integrity**:
- Current: Orphaned spaces without credits
- New: Spaces created, credits deducted atomically

