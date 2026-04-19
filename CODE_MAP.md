# Code Map: Critical Path Reference

Quick navigation for understanding how your analysis engine works.

---

## **Entry Point: User Analysis Request**

```
Frontend Component
    ↓ (POST request with text)
src/app/api/analyze/route.ts ← YOU ARE HERE
    ↓
[Three Passes Below]
```

---

## **The Three Analysis Passes**

### **Pass 1: Streaming Decomposition**
- **File:** `src/app/api/analyze/route.ts` (lines 120-128)
- **What:** Breaks down text into concepts
- **Calls:** `llmStream()` from `src/lib/llm.ts`
- **Output:** Streams chunks to frontend as `delta` events
- **Saves:** Raw text in `rawDecomposition` variable

### **Pass 2: Structuring (JSON Conversion)**
- **File:** `src/app/api/analyze/route.ts` (lines 130-155)
- **What:** Converts Pass 1 output to structured JSON
- **Calls:** `llmJSON()` from `src/lib/llm.ts`
- **Returns Type:** `StructuredDecomposition` from `src/types/analysis.ts`
- **If Fails:** Analysis marked `blocked`, saved to database
- **Database Inserts:** Lines 162-420 (entities, edges, cycles, etc.)

### **Pass 3: Synthesis (Strategic Summary)**
- **File:** `src/app/api/analyze/route.ts` (lines 446-476)
- **What:** Deep analysis of relationships and patterns
- **Calls:** `llmJSON()` with `SYNTHESIS_SYSTEM_PROMPT`
- **Stores:** `synthesis_data` in spaces table
- **If Fails:** Fallback uses basic synthesis from Pass 2

---

## **Key Dependencies to Learn (Priority Order)**

| Priority | File | What It Does | Why It Matters |
|----------|------|--------------|----------------|
| 🔴 **1** | `src/types/analysis.ts` | Defines `StructuredDecomposition` | You must know what shape the LLM returns |
| 🔴 **2** | `src/lib/llm.ts` | `llmStream()` and `llmJSON()` functions | How your code calls Claude AI |
| 🟠 **3** | `src/lib/credits.ts` | `checkCredits()`, `deductCredits()` | Billing/auth system |
| 🟠 **4** | `supabase/schema.sql` | Database table definitions | What data gets stored where |
| 🟡 **5** | `src/lib/prompts/` | System prompts for each pass | How Claude is instructed to think |

---

## **Data Flow Through Database**

**After Pass 2 structuring:**

```
StructuredDecomposition
├─ entities[] → Insert to `entities` table
├─ edges[] → Insert to `edges` table (individually to avoid batch failure)
├─ cycles[] → Insert to `cycles` table
├─ propositions[] → Insert to `propositions` table
├─ scenarios[] → Insert to `scenarios` table
├─ action_items[] → Insert to `action_items` table
├─ novel_connections[] → Insert to `novel_connections` table
└─ contradictions[] → Insert to `contradictions` table

All linked by: space_id (references `spaces` table)
```

**Key File:** `src/app/api/analyze/route.ts` lines 162-420

---

## **Critical Failure Points (Debug Here)**

| Issue | File | Lines | Common Cause |
|-------|------|-------|--------------|
| **User can't analyze** | `route.ts` | 12-30 | Auth check or insufficient credits |
| **Request rejected** | `route.ts` | 32-58 | Input validation (text too short/long) |
| **Analysis blocked** | `route.ts` | 130-155 | Pass 2 structuring failed (LLM couldn't parse) |
| **Data not saved** | `route.ts` | 162-420 | Database insert error (see console logs) |
| **No real-time updates** | `route.ts` | 115-117 | Frontend not listening to SSE events |

---

## **Quick Lookup: What Each Event Type Means**

Sent via SSE from `route.ts` line 125:

| Event | What It Means | When Sent |
|-------|---------------|-----------|
| `delta` | New decomposition chunk | Pass 1 streaming |
| `phase` | Stage changed | After Pass 1 → "structuring", after Pass 2 → "synthesizing" |
| `error` | Something failed | Any pass if error occurs |
| `complete` | Analysis done | At end with `{ spaceId, creditsUsed, newBalance }` |

---

## **How to Debug**

1. **Add `console.error()` logs** at error catch points (lines 147, 293, 376, etc.)
2. **Check database directly** for partially inserted data
3. **Look at browser DevTools** → Network tab to see SSE events coming through
4. **Review Pass 2 output** if data looks wrong—problem is usually in LLM structuring

---

## **Learning Checklist**

- [ ] Understand Pass 1 (decomposition streaming)
- [ ] Understand Pass 2 (JSON structuring)
- [ ] Understand Pass 3 (synthesis)
- [ ] Know what `StructuredDecomposition` type contains
- [ ] Trace one entity from LLM output → database
- [ ] Understand SSE event flow to frontend
- [ ] Know what happens when edge insert fails (line 339-355)
- [ ] Understand credit deduction timing (line 434)
