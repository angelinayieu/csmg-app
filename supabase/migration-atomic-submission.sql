-- Atomic analysis submission function
-- Replaces sequential client-side operations with single atomic database operation
-- Prevents race condition: credits deducted even if inserts fail

CREATE OR REPLACE FUNCTION public.submit_analysis(
  p_user_id UUID,
  p_tier TEXT,
  p_credit_cost INTEGER,
  p_space_data JSONB
)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_space_id UUID;
  v_space_ids UUID[];
  v_entity_map JSONB := '{}'::JSONB;
  v_entity_record RECORD;
  v_new_balance INTEGER;
  v_error_msg TEXT;
BEGIN
  -- Start transaction implicitly (entire function is atomic)
  
  -- Step 1: Check credit balance before ANY modifications
  SELECT credit_balance INTO v_new_balance FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  
  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;
  
  IF v_new_balance < p_credit_cost THEN
    RAISE EXCEPTION 'Insufficient credits: have %, need %', v_new_balance, p_credit_cost;
  END IF;
  
  -- Step 2: Process each space
  FOR v_space_id IN
    SELECT (space_obj->>'id')::UUID FROM jsonb_array_elements(p_space_data) AS space_obj
  LOOP
    BEGIN
      -- Create space record
      INSERT INTO public.spaces (
        id, user_id, name, description, space_prefix, input_text,
        raw_decomposition, synthesis_text, synthesis_data,
        entity_count, edge_count, orphan_count, cycle_count,
        maturity, analysis_tier, credits_used, agent_count, created_at
      )
      SELECT
        (sp->>'id')::UUID, p_user_id, sp->>'name', sp->>'description',
        sp->>'space_prefix', sp->>'input_text', sp->>'raw_decomposition',
        sp->>'synthesis_text', (sp->'synthesis_data')::JSONB,
        (sp->>'entity_count')::INTEGER, (sp->>'edge_count')::INTEGER,
        (sp->>'orphan_count')::INTEGER, (sp->>'cycle_count')::INTEGER,
        sp->>'maturity', p_tier, 0, (sp->>'agent_count')::INTEGER, NOW()
      FROM (SELECT sp FROM jsonb_array_elements(p_space_data) sp WHERE (sp->>'id')::UUID = v_space_id) sub(sp)
      WHERE NOT EXISTS (SELECT 1 FROM public.spaces WHERE id = v_space_id);
      
      v_space_ids := array_append(v_space_ids, v_space_id);
      
    EXCEPTION WHEN OTHERS THEN
      v_error_msg := 'Space creation failed: ' || SQLERRM;
      RAISE EXCEPTION '%', v_error_msg;
    END;
  END LOOP;
  
  -- Step 3: If all spaces created successfully, deduct credits
  -- Only happens if we reach here (no exceptions thrown)
  UPDATE public.profiles 
  SET credit_balance = v_new_balance - p_credit_cost
  WHERE id = p_user_id;
  
  INSERT INTO public.credit_ledger (user_id, amount, reason, space_id, balance_after, created_at)
  VALUES (p_user_id, -p_credit_cost, 'analysis_' || p_tier, v_space_ids[1], v_new_balance - p_credit_cost, NOW());
  
  -- Step 4: Return success with space IDs
  RETURN jsonb_build_object(
    'success', true,
    'space_ids', to_jsonb(v_space_ids),
    'new_balance', v_new_balance - p_credit_cost
  );
  
EXCEPTION WHEN OTHERS THEN
  -- Entire transaction rolled back automatically
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'space_ids', '[]'::JSONB
  );
END;
$$ LANGUAGE plpgsql;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.submit_analysis TO authenticated;
