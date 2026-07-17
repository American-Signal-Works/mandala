export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_deletion_requests: {
        Row: {
          attempt_count: number
          auth_deleted_at: string | null
          completed_at: string | null
          last_error_code: string | null
          preflighted_at: string
          requested_at: string
          sessions_revoked_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          auth_deleted_at?: string | null
          completed_at?: string | null
          last_error_code?: string | null
          preflighted_at?: string
          requested_at?: string
          sessions_revoked_at?: string | null
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          auth_deleted_at?: string | null
          completed_at?: string | null
          last_error_code?: string | null
          preflighted_at?: string
          requested_at?: string
          sessions_revoked_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_action_definitions: {
        Row: {
          action_key: string
          allowed_modes: string[]
          approval_rule: Json
          audit_classification: string
          capability_version_id: string
          created_at: string
          id: string
          idempotency_scope: string
          input_schema: Json
          output_schema: Json
          retry_class: string
          status: string
          timeout_ms: number
          version: string
        }
        Insert: {
          action_key: string
          allowed_modes: string[]
          approval_rule?: Json
          audit_classification: string
          capability_version_id: string
          created_at?: string
          id?: string
          idempotency_scope: string
          input_schema: Json
          output_schema: Json
          retry_class: string
          status?: string
          timeout_ms: number
          version: string
        }
        Update: {
          action_key?: string
          allowed_modes?: string[]
          approval_rule?: Json
          audit_classification?: string
          capability_version_id?: string
          created_at?: string
          id?: string
          idempotency_scope?: string
          input_schema?: Json
          output_schema?: Json
          retry_class?: string
          status?: string
          timeout_ms?: number
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_action_definitions_capability_version_id_fkey"
            columns: ["capability_version_id"]
            isOneToOne: false
            referencedRelation: "capability_definition_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_escalations: {
        Row: {
          active_key: string
          closed_at: string | null
          company_id: string
          created_at: string
          follow_up_id: string
          id: string
          occurrence: number
          opened_at: string
          reason: string
          resolution: Json
          severity: string
          status: string
          updated_at: string
          workflow_item_id: string | null
        }
        Insert: {
          active_key: string
          closed_at?: string | null
          company_id: string
          created_at?: string
          follow_up_id: string
          id?: string
          occurrence?: number
          opened_at?: string
          reason: string
          resolution?: Json
          severity: string
          status?: string
          updated_at?: string
          workflow_item_id?: string | null
        }
        Update: {
          active_key?: string
          closed_at?: string | null
          company_id?: string
          created_at?: string
          follow_up_id?: string
          id?: string
          occurrence?: number
          opened_at?: string
          reason?: string
          resolution?: Json
          severity?: string
          status?: string
          updated_at?: string
          workflow_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_escalations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_escalations_follow_up_id_company_id_fkey"
            columns: ["follow_up_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_follow_ups"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "agent_escalations_workflow_item_id_company_id_fkey"
            columns: ["workflow_item_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_items"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      agent_evaluation_cases: {
        Row: {
          case_key: string
          company_id: string
          created_at: string
          created_by: string
          evidence_digest: string | null
          fixture: Json
          id: string
          input_digest: string
          missing_data_state: string
          version: string
        }
        Insert: {
          case_key: string
          company_id: string
          created_at?: string
          created_by: string
          evidence_digest?: string | null
          fixture: Json
          id?: string
          input_digest: string
          missing_data_state: string
          version: string
        }
        Update: {
          case_key?: string
          company_id?: string
          created_at?: string
          created_by?: string
          evidence_digest?: string | null
          fixture?: Json
          id?: string
          input_digest?: string
          missing_data_state?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_evaluation_cases_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_evaluation_outcome_labels: {
        Row: {
          company_id: string
          created_at: string
          evaluation_run_id: string | null
          id: string
          labelled_by: string | null
          outcome: string
          recommendation_run_id: string | null
          recommendation_version: string | null
          workflow_run_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          evaluation_run_id?: string | null
          id?: string
          labelled_by?: string | null
          outcome: string
          recommendation_run_id?: string | null
          recommendation_version?: string | null
          workflow_run_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          evaluation_run_id?: string | null
          id?: string
          labelled_by?: string | null
          outcome?: string
          recommendation_run_id?: string | null
          recommendation_version?: string | null
          workflow_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_evaluation_outcome_labe_evaluation_run_id_company_id_fkey"
            columns: ["evaluation_run_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_evaluation_runs"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "agent_evaluation_outcome_labe_recommendation_run_id_compan_fkey"
            columns: ["recommendation_run_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_recommendation_runs"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "agent_evaluation_outcome_labels_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_evaluation_outcome_labels_workflow_run_id_company_id_fkey"
            columns: ["workflow_run_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      agent_evaluation_runs: {
        Row: {
          company_id: string
          confidence_definition_version: string
          created_at: string
          dataset_digest: string
          evaluation_case_id: string
          evaluator_version: string
          id: string
          manifest_digest: string
          metrics: Json
          missing_data: Json
          model_version: string | null
          recommendation_run_id: string | null
          recommendation_version: string | null
          safe_trace_ids: Json
          threshold_decision: string
          workflow_id: string
          workflow_run_id: string | null
        }
        Insert: {
          company_id: string
          confidence_definition_version: string
          created_at?: string
          dataset_digest: string
          evaluation_case_id: string
          evaluator_version: string
          id?: string
          manifest_digest: string
          metrics?: Json
          missing_data?: Json
          model_version?: string | null
          recommendation_run_id?: string | null
          recommendation_version?: string | null
          safe_trace_ids?: Json
          threshold_decision: string
          workflow_id: string
          workflow_run_id?: string | null
        }
        Update: {
          company_id?: string
          confidence_definition_version?: string
          created_at?: string
          dataset_digest?: string
          evaluation_case_id?: string
          evaluator_version?: string
          id?: string
          manifest_digest?: string
          metrics?: Json
          missing_data?: Json
          model_version?: string | null
          recommendation_run_id?: string | null
          recommendation_version?: string | null
          safe_trace_ids?: Json
          threshold_decision?: string
          workflow_id?: string
          workflow_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_evaluation_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_evaluation_runs_evaluation_case_id_company_id_fkey"
            columns: ["evaluation_case_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_evaluation_cases"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "agent_evaluation_runs_recommendation_run_id_company_id_fkey"
            columns: ["recommendation_run_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_recommendation_runs"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "agent_evaluation_runs_workflow_id_company_id_fkey"
            columns: ["workflow_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_workflows"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "agent_evaluation_runs_workflow_run_id_company_id_fkey"
            columns: ["workflow_run_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      agent_execution_receipts: {
        Row: {
          action_attempt_id: string
          company_id: string
          effect_state: string
          failure_class: string | null
          id: string
          provider_idempotency_key: string | null
          provider_reference: string | null
          receipt_sequence: number
          reconciliation_evidence: Json
          recorded_at: string
          request_hash: string
          response_hash: string | null
          safe_output: Json
          status: string
        }
        Insert: {
          action_attempt_id: string
          company_id: string
          effect_state: string
          failure_class?: string | null
          id?: string
          provider_idempotency_key?: string | null
          provider_reference?: string | null
          receipt_sequence?: number
          reconciliation_evidence?: Json
          recorded_at?: string
          request_hash: string
          response_hash?: string | null
          safe_output?: Json
          status: string
        }
        Update: {
          action_attempt_id?: string
          company_id?: string
          effect_state?: string
          failure_class?: string | null
          id?: string
          provider_idempotency_key?: string | null
          provider_reference?: string | null
          receipt_sequence?: number
          reconciliation_evidence?: Json
          recorded_at?: string
          request_hash?: string
          response_hash?: string | null
          safe_output?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_execution_receipts_action_attempt_id_company_id_fkey"
            columns: ["action_attempt_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_action_attempts"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "agent_execution_receipts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_feedback: {
        Row: {
          actor_id: string
          client_surface: string
          company_id: string
          correction: string | null
          created_at: string
          decision: string
          downstream_outcome: Json
          id: string
          label: string | null
          reason: string | null
          recommendation_run_id: string
          recommendation_version: string
          structured_fields: Json
          workflow_item_id: string
        }
        Insert: {
          actor_id: string
          client_surface?: string
          company_id: string
          correction?: string | null
          created_at?: string
          decision: string
          downstream_outcome?: Json
          id?: string
          label?: string | null
          reason?: string | null
          recommendation_run_id: string
          recommendation_version: string
          structured_fields?: Json
          workflow_item_id: string
        }
        Update: {
          actor_id?: string
          client_surface?: string
          company_id?: string
          correction?: string | null
          created_at?: string
          decision?: string
          downstream_outcome?: Json
          id?: string
          label?: string | null
          reason?: string | null
          recommendation_run_id?: string
          recommendation_version?: string
          structured_fields?: Json
          workflow_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_feedback_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_feedback_recommendation_run_id_company_id_fkey"
            columns: ["recommendation_run_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_recommendation_runs"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "agent_feedback_workflow_item_id_company_id_fkey"
            columns: ["workflow_item_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_items"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      agent_follow_ups: {
        Row: {
          action_attempt_id: string | null
          attempts: number
          available_at: string
          company_id: string
          condition: Json
          condition_type: string
          created_at: string
          due_at: string
          id: string
          last_evaluated_at: string | null
          lease_id: string | null
          lease_owner: string | null
          leased_until: string | null
          max_attempts: number
          occurrence: number
          recurrence_policy: string
          resolution: Json
          resolved_at: string | null
          rule_version: string
          severity: string
          status: string
          suppression: Json
          updated_at: string
          workflow_id: string
          workflow_item_id: string | null
          workflow_run_id: string | null
        }
        Insert: {
          action_attempt_id?: string | null
          attempts?: number
          available_at?: string
          company_id: string
          condition?: Json
          condition_type: string
          created_at?: string
          due_at: string
          id?: string
          last_evaluated_at?: string | null
          lease_id?: string | null
          lease_owner?: string | null
          leased_until?: string | null
          max_attempts?: number
          occurrence?: number
          recurrence_policy?: string
          resolution?: Json
          resolved_at?: string | null
          rule_version: string
          severity: string
          status?: string
          suppression?: Json
          updated_at?: string
          workflow_id: string
          workflow_item_id?: string | null
          workflow_run_id?: string | null
        }
        Update: {
          action_attempt_id?: string | null
          attempts?: number
          available_at?: string
          company_id?: string
          condition?: Json
          condition_type?: string
          created_at?: string
          due_at?: string
          id?: string
          last_evaluated_at?: string | null
          lease_id?: string | null
          lease_owner?: string | null
          leased_until?: string | null
          max_attempts?: number
          occurrence?: number
          recurrence_policy?: string
          resolution?: Json
          resolved_at?: string | null
          rule_version?: string
          severity?: string
          status?: string
          suppression?: Json
          updated_at?: string
          workflow_id?: string
          workflow_item_id?: string | null
          workflow_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_follow_ups_action_attempt_id_company_id_fkey"
            columns: ["action_attempt_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_action_attempts"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "agent_follow_ups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_follow_ups_workflow_id_company_id_fkey"
            columns: ["workflow_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_workflows"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "agent_follow_ups_workflow_item_id_company_id_fkey"
            columns: ["workflow_item_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_items"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "agent_follow_ups_workflow_run_id_company_id_fkey"
            columns: ["workflow_run_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      agent_lifecycle_events: {
        Row: {
          actor_id: string | null
          company_id: string
          created_at: string
          from_state: string
          id: string
          reason: string
          runtime_state_id: string
          state_version: number
          to_state: string
          transition: string
          workflow_id: string
        }
        Insert: {
          actor_id?: string | null
          company_id: string
          created_at?: string
          from_state: string
          id?: string
          reason: string
          runtime_state_id: string
          state_version: number
          to_state: string
          transition: string
          workflow_id: string
        }
        Update: {
          actor_id?: string | null
          company_id?: string
          created_at?: string
          from_state?: string
          id?: string
          reason?: string
          runtime_state_id?: string
          state_version?: number
          to_state?: string
          transition?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_lifecycle_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_lifecycle_events_runtime_state_id_company_id_fkey"
            columns: ["runtime_state_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_runtime_states"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "agent_lifecycle_events_workflow_id_company_id_fkey"
            columns: ["workflow_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_workflows"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      agent_memory_candidates: {
        Row: {
          approved_at: string | null
          company_id: string
          confidence: number
          content: Json
          created_at: string
          expires_at: string | null
          feedback_id: string | null
          forgotten_at: string | null
          id: string
          memory_type: string
          provenance: Json
          provider_key: string | null
          provider_reference: string | null
          retention_until: string | null
          review_reason: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          revoked_at: string | null
          scope: Json
          status: string
          superseded_by: string | null
          updated_at: string
          workflow_id: string | null
        }
        Insert: {
          approved_at?: string | null
          company_id: string
          confidence: number
          content: Json
          created_at?: string
          expires_at?: string | null
          feedback_id?: string | null
          forgotten_at?: string | null
          id?: string
          memory_type: string
          provenance: Json
          provider_key?: string | null
          provider_reference?: string | null
          retention_until?: string | null
          review_reason?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          revoked_at?: string | null
          scope?: Json
          status?: string
          superseded_by?: string | null
          updated_at?: string
          workflow_id?: string | null
        }
        Update: {
          approved_at?: string | null
          company_id?: string
          confidence?: number
          content?: Json
          created_at?: string
          expires_at?: string | null
          feedback_id?: string | null
          forgotten_at?: string | null
          id?: string
          memory_type?: string
          provenance?: Json
          provider_key?: string | null
          provider_reference?: string | null
          retention_until?: string | null
          review_reason?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          revoked_at?: string | null
          scope?: Json
          status?: string
          superseded_by?: string | null
          updated_at?: string
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_memory_candidates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_memory_candidates_feedback_id_company_id_fkey"
            columns: ["feedback_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_feedback"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "agent_memory_candidates_superseded_by_company_id_fkey"
            columns: ["superseded_by", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_memory_candidates"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "agent_memory_candidates_workflow_id_company_id_fkey"
            columns: ["workflow_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_workflows"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      agent_monitoring_events: {
        Row: {
          actor_id: string | null
          actor_type: string
          company_id: string
          created_at: string
          details: Json
          escalation_id: string | null
          event_sequence: number
          event_type: string
          follow_up_id: string
          id: string
          occurrence: number
          reason: string | null
          worker_id: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_type: string
          company_id: string
          created_at?: string
          details?: Json
          escalation_id?: string | null
          event_sequence?: never
          event_type: string
          follow_up_id: string
          id?: string
          occurrence: number
          reason?: string | null
          worker_id?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          company_id?: string
          created_at?: string
          details?: Json
          escalation_id?: string | null
          event_sequence?: never
          event_type?: string
          follow_up_id?: string
          id?: string
          occurrence?: number
          reason?: string | null
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_monitoring_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_monitoring_events_escalation_id_company_id_fkey"
            columns: ["escalation_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_escalations"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "agent_monitoring_events_follow_up_id_company_id_fkey"
            columns: ["follow_up_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_follow_ups"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      agent_promotion_checkpoints: {
        Row: {
          company_id: string
          created_at: string
          decision: string
          evaluation_run_id: string
          id: string
          reason: string
          thresholds: Json
          workflow_id: string
          workflow_version: string
        }
        Insert: {
          company_id: string
          created_at?: string
          decision: string
          evaluation_run_id: string
          id?: string
          reason: string
          thresholds: Json
          workflow_id: string
          workflow_version: string
        }
        Update: {
          company_id?: string
          created_at?: string
          decision?: string
          evaluation_run_id?: string
          id?: string
          reason?: string
          thresholds?: Json
          workflow_id?: string
          workflow_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_promotion_checkpoints_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_promotion_checkpoints_evaluation_run_id_company_id_fkey"
            columns: ["evaluation_run_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_evaluation_runs"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "agent_promotion_checkpoints_workflow_id_company_id_fkey"
            columns: ["workflow_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_workflows"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      agent_runtime_states: {
        Row: {
          binding_snapshot_id: string | null
          company_id: string
          created_at: string
          id: string
          last_sample_run_id: string | null
          lifecycle_state: string
          readiness_checked_at: string | null
          readiness_hash: string | null
          readiness_issues: Json
          readiness_status: string
          state_version: number
          updated_at: string
          updated_by: string | null
          workflow_id: string
        }
        Insert: {
          binding_snapshot_id?: string | null
          company_id: string
          created_at?: string
          id?: string
          last_sample_run_id?: string | null
          lifecycle_state?: string
          readiness_checked_at?: string | null
          readiness_hash?: string | null
          readiness_issues?: Json
          readiness_status?: string
          state_version?: number
          updated_at?: string
          updated_by?: string | null
          workflow_id: string
        }
        Update: {
          binding_snapshot_id?: string | null
          company_id?: string
          created_at?: string
          id?: string
          last_sample_run_id?: string | null
          lifecycle_state?: string
          readiness_checked_at?: string | null
          readiness_hash?: string | null
          readiness_issues?: Json
          readiness_status?: string
          state_version?: number
          updated_at?: string
          updated_by?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_runtime_states_binding_snapshot_id_company_id_workfl_fkey"
            columns: ["binding_snapshot_id", "company_id", "workflow_id"]
            isOneToOne: false
            referencedRelation: "workflow_binding_snapshots"
            referencedColumns: ["id", "company_id", "workflow_id"]
          },
          {
            foreignKeyName: "agent_runtime_states_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runtime_states_last_sample_run_id_company_id_fkey"
            columns: ["last_sample_run_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "agent_runtime_states_workflow_id_company_id_fkey"
            columns: ["workflow_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_workflows"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      agent_signal_change_windows: {
        Row: {
          change_count: number
          change_kinds: string[]
          company_id: string
          created_at: string
          dispatched_at: string | null
          first_changed_at: string
          id: string
          last_changed_at: string
          record_type: string
          sample_record_ids: string[]
          sample_truncated: boolean
          source_id: string
          transaction_id: number
          updated_at: string
        }
        Insert: {
          change_count?: number
          change_kinds: string[]
          company_id: string
          created_at?: string
          dispatched_at?: string | null
          first_changed_at?: string
          id?: string
          last_changed_at?: string
          record_type: string
          sample_record_ids?: string[]
          sample_truncated?: boolean
          source_id: string
          transaction_id: number
          updated_at?: string
        }
        Update: {
          change_count?: number
          change_kinds?: string[]
          company_id?: string
          created_at?: string
          dispatched_at?: string | null
          first_changed_at?: string
          id?: string
          last_changed_at?: string
          record_type?: string
          sample_record_ids?: string[]
          sample_truncated?: boolean
          source_id?: string
          transaction_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_signal_change_windows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_signal_change_windows_source_id_company_id_fkey"
            columns: ["source_id", "company_id"]
            isOneToOne: false
            referencedRelation: "external_sources"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      agent_signal_dispatch_events: {
        Row: {
          actor_type: string
          company_id: string
          created_at: string
          details: Json
          dispatch_id: string
          event_sequence: number
          event_type: string
          id: string
          reason: string | null
          worker_id: string | null
        }
        Insert: {
          actor_type: string
          company_id: string
          created_at?: string
          details?: Json
          dispatch_id: string
          event_sequence?: never
          event_type: string
          id?: string
          reason?: string | null
          worker_id?: string | null
        }
        Update: {
          actor_type?: string
          company_id?: string
          created_at?: string
          details?: Json
          dispatch_id?: string
          event_sequence?: never
          event_type?: string
          id?: string
          reason?: string | null
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_signal_dispatch_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_signal_dispatch_events_dispatch_id_company_id_fkey"
            columns: ["dispatch_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_signal_dispatches"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      agent_signal_dispatches: {
        Row: {
          attempts: number
          available_at: string
          binding_snapshot_id: string
          change_window_id: string | null
          company_id: string
          completed_at: string | null
          created_at: string
          dedupe_key: string
          execution_mode: string
          id: string
          input: Json
          lease_id: string | null
          lease_owner: string | null
          leased_until: string | null
          max_attempts: number
          result: Json
          signal_kind: string
          status: string
          trigger_id: string
          trigger_kind: string
          trigger_snapshot: Json
          updated_at: string
          workflow_id: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          binding_snapshot_id: string
          change_window_id?: string | null
          company_id: string
          completed_at?: string | null
          created_at?: string
          dedupe_key: string
          execution_mode: string
          id?: string
          input?: Json
          lease_id?: string | null
          lease_owner?: string | null
          leased_until?: string | null
          max_attempts?: number
          result?: Json
          signal_kind: string
          status?: string
          trigger_id: string
          trigger_kind: string
          trigger_snapshot: Json
          updated_at?: string
          workflow_id: string
        }
        Update: {
          attempts?: number
          available_at?: string
          binding_snapshot_id?: string
          change_window_id?: string | null
          company_id?: string
          completed_at?: string | null
          created_at?: string
          dedupe_key?: string
          execution_mode?: string
          id?: string
          input?: Json
          lease_id?: string | null
          lease_owner?: string | null
          leased_until?: string | null
          max_attempts?: number
          result?: Json
          signal_kind?: string
          status?: string
          trigger_id?: string
          trigger_kind?: string
          trigger_snapshot?: Json
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_signal_dispatches_binding_snapshot_id_company_id_wor_fkey"
            columns: ["binding_snapshot_id", "company_id", "workflow_id"]
            isOneToOne: false
            referencedRelation: "workflow_binding_snapshots"
            referencedColumns: ["id", "company_id", "workflow_id"]
          },
          {
            foreignKeyName: "agent_signal_dispatches_change_window_id_company_id_fkey"
            columns: ["change_window_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_signal_change_windows"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "agent_signal_dispatches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_signal_dispatches_workflow_id_company_id_fkey"
            columns: ["workflow_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_workflows"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      agent_tool_definitions: {
        Row: {
          access_class: string
          allowed_modes: string[]
          capability_version_id: string
          created_at: string
          id: string
          input_schema: Json
          output_schema: Json
          safe_error_schema: Json
          status: string
          tool_key: string
          version: string
        }
        Insert: {
          access_class: string
          allowed_modes: string[]
          capability_version_id: string
          created_at?: string
          id?: string
          input_schema: Json
          output_schema: Json
          safe_error_schema?: Json
          status?: string
          tool_key: string
          version: string
        }
        Update: {
          access_class?: string
          allowed_modes?: string[]
          capability_version_id?: string
          created_at?: string
          id?: string
          input_schema?: Json
          output_schema?: Json
          safe_error_schema?: Json
          status?: string
          tool_key?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_tool_definitions_capability_version_id_fkey"
            columns: ["capability_version_id"]
            isOneToOne: false
            referencedRelation: "capability_definition_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_workflows: {
        Row: {
          company_id: string
          compile_result: Json
          compiled_at: string | null
          compiled_manifest_hash: string | null
          compiler_diagnostics: Json | null
          compiler_version: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          skill_markdown: string | null
          skill_source_hash: string | null
          spec: Json
          status: string
          updated_at: string
          updated_by: string | null
          version: string
          workflow_key: string
          workflow_type: string
        }
        Insert: {
          company_id: string
          compile_result?: Json
          compiled_at?: string | null
          compiled_manifest_hash?: string | null
          compiler_diagnostics?: Json | null
          compiler_version?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          skill_markdown?: string | null
          skill_source_hash?: string | null
          spec: Json
          status?: string
          updated_at?: string
          updated_by?: string | null
          version: string
          workflow_key: string
          workflow_type: string
        }
        Update: {
          company_id?: string
          compile_result?: Json
          compiled_at?: string | null
          compiled_manifest_hash?: string | null
          compiler_diagnostics?: Json | null
          compiler_version?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          skill_markdown?: string | null
          skill_source_hash?: string | null
          spec?: Json
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: string
          workflow_key?: string
          workflow_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_workflows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      capability_definition_versions: {
        Row: {
          capability_definition_id: string
          created_at: string
          id: string
          input_schema: Json
          output_schema: Json
          schema_hash: string
          status: string
          version: string
        }
        Insert: {
          capability_definition_id: string
          created_at?: string
          id?: string
          input_schema: Json
          output_schema: Json
          schema_hash: string
          status?: string
          version: string
        }
        Update: {
          capability_definition_id?: string
          created_at?: string
          id?: string
          input_schema?: Json
          output_schema?: Json
          schema_hash?: string
          status?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "capability_definition_versions_capability_definition_id_fkey"
            columns: ["capability_definition_id"]
            isOneToOne: false
            referencedRelation: "capability_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      capability_definitions: {
        Row: {
          capability_key: string
          created_at: string
          description: string
          display_name: string
          effect: string
          id: string
          risk_class: string
          status: string
        }
        Insert: {
          capability_key: string
          created_at?: string
          description?: string
          display_name: string
          effect: string
          id?: string
          risk_class: string
          status?: string
        }
        Update: {
          capability_key?: string
          created_at?: string
          description?: string
          display_name?: string
          effect?: string
          id?: string
          risk_class?: string
          status?: string
        }
        Relationships: []
      }
      capability_field_classifications: {
        Row: {
          capability_version_id: string
          classification: string
          created_at: string
          json_pointer: string
          model_allowed: boolean
          terminal_allowed: boolean
        }
        Insert: {
          capability_version_id: string
          classification: string
          created_at?: string
          json_pointer: string
          model_allowed?: boolean
          terminal_allowed?: boolean
        }
        Update: {
          capability_version_id?: string
          classification?: string
          created_at?: string
          json_pointer?: string
          model_allowed?: boolean
          terminal_allowed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "capability_field_classifications_capability_version_id_fkey"
            columns: ["capability_version_id"]
            isOneToOne: false
            referencedRelation: "capability_definition_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      cli_authorization_attempts: {
        Row: {
          attempt_kind: string
          attempted_at: string
          id: number
          subject_hash: string
        }
        Insert: {
          attempt_kind: string
          attempted_at?: string
          id?: never
          subject_hash: string
        }
        Update: {
          attempt_kind?: string
          attempted_at?: string
          id?: never
          subject_hash?: string
        }
        Relationships: []
      }
      cli_device_authorizations: {
        Row: {
          approved_at: string | null
          approved_user_id: string | null
          browser_token_hash: string
          client_name: string
          client_platform: string
          client_version: string
          consumed_at: string | null
          created_at: string
          denied_at: string | null
          device_code_hash: string
          exchange_nonce: string | null
          expires_at: string
          id: string
          last_polled_at: string | null
          poll_attempts: number
          poll_interval_seconds: number
          requested_scopes: string[]
          requester_hash: string
          selected_company_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_user_id?: string | null
          browser_token_hash: string
          client_name: string
          client_platform: string
          client_version: string
          consumed_at?: string | null
          created_at?: string
          denied_at?: string | null
          device_code_hash: string
          exchange_nonce?: string | null
          expires_at: string
          id: string
          last_polled_at?: string | null
          poll_attempts?: number
          poll_interval_seconds?: number
          requested_scopes?: string[]
          requester_hash: string
          selected_company_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_user_id?: string | null
          browser_token_hash?: string
          client_name?: string
          client_platform?: string
          client_version?: string
          consumed_at?: string | null
          created_at?: string
          denied_at?: string | null
          device_code_hash?: string
          exchange_nonce?: string | null
          expires_at?: string
          id?: string
          last_polled_at?: string | null
          poll_attempts?: number
          poll_interval_seconds?: number
          requested_scopes?: string[]
          requester_hash?: string
          selected_company_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cli_device_authorizations_selected_company_id_fkey"
            columns: ["selected_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      cli_sessions: {
        Row: {
          access_expires_at: string
          access_token_hash: string
          actor_auth_session_id: string
          actor_session_ciphertext: string
          client_name: string
          client_platform: string
          client_version: string
          created_at: string
          id: string
          last_used_at: string
          refresh_expires_at: string
          refresh_token_hash: string
          revocation_reason: string | null
          revoked_at: string | null
          scopes: string[]
          selected_company_id: string | null
          user_id: string
        }
        Insert: {
          access_expires_at: string
          access_token_hash: string
          actor_auth_session_id: string
          actor_session_ciphertext: string
          client_name: string
          client_platform: string
          client_version: string
          created_at?: string
          id?: string
          last_used_at?: string
          refresh_expires_at: string
          refresh_token_hash: string
          revocation_reason?: string | null
          revoked_at?: string | null
          scopes?: string[]
          selected_company_id?: string | null
          user_id: string
        }
        Update: {
          access_expires_at?: string
          access_token_hash?: string
          actor_auth_session_id?: string
          actor_session_ciphertext?: string
          client_name?: string
          client_platform?: string
          client_version?: string
          created_at?: string
          id?: string
          last_used_at?: string
          refresh_expires_at?: string
          refresh_token_hash?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          scopes?: string[]
          selected_company_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cli_sessions_selected_company_id_fkey"
            columns: ["selected_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_fields: {
        Row: {
          collection_id: string
          config: Json
          created_at: string
          id: string
          is_system: boolean
          name: string
          options: Json
          owner_id: string
          owner_type: string
          sort_index: number
          type: string
        }
        Insert: {
          collection_id: string
          config?: Json
          created_at?: string
          id?: string
          is_system?: boolean
          name: string
          options?: Json
          owner_id: string
          owner_type?: string
          sort_index?: number
          type: string
        }
        Update: {
          collection_id?: string
          config?: Json
          created_at?: string
          id?: string
          is_system?: boolean
          name?: string
          options?: Json
          owner_id?: string
          owner_type?: string
          sort_index?: number
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_fields_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_rows: {
        Row: {
          collection_id: string
          created_at: string
          data: Json
          id: string
          owner_id: string
          owner_type: string
          source: string
          source_external_id: string | null
          updated_at: string
        }
        Insert: {
          collection_id: string
          created_at?: string
          data?: Json
          id?: string
          owner_id: string
          owner_type?: string
          source?: string
          source_external_id?: string | null
          updated_at?: string
        }
        Update: {
          collection_id?: string
          created_at?: string
          data?: Json
          id?: string
          owner_id?: string
          owner_type?: string
          source?: string
          source_external_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_rows_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_views: {
        Row: {
          collection_id: string
          config: Json
          created_at: string
          id: string
          is_default: boolean
          name: string
          owner_id: string
          owner_type: string
          sort_index: number
          type: string
        }
        Insert: {
          collection_id: string
          config?: Json
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          owner_id: string
          owner_type?: string
          sort_index?: number
          type?: string
        }
        Update: {
          collection_id?: string
          config?: Json
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          owner_id?: string
          owner_type?: string
          sort_index?: number
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_views_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
        ]
      }
      collections: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          is_system: boolean
          managed_by_connection: string | null
          name: string
          owner_id: string
          owner_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_system?: boolean
          managed_by_connection?: string | null
          name: string
          owner_id: string
          owner_type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_system?: boolean
          managed_by_connection?: string | null
          name?: string
          owner_id?: string
          owner_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          created_at: string
          created_by: string | null
          created_by_snapshot: string
          id: string
          logo_path: string | null
          name: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_by_snapshot: string
          id?: string
          logo_path?: string | null
          name: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_by_snapshot?: string
          id?: string
          logo_path?: string | null
          name?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      company_approval_policies: {
        Row: {
          action_type: string
          company_id: string
          created_at: string
          id: string
          minimum_role: string
          require_human_approval: boolean
          require_warning_acknowledgement: boolean
          updated_at: string
          workflow_type: string
        }
        Insert: {
          action_type: string
          company_id: string
          created_at?: string
          id?: string
          minimum_role?: string
          require_human_approval?: boolean
          require_warning_acknowledgement?: boolean
          updated_at?: string
          workflow_type: string
        }
        Update: {
          action_type?: string
          company_id?: string
          created_at?: string
          id?: string
          minimum_role?: string
          require_human_approval?: boolean
          require_warning_acknowledgement?: boolean
          updated_at?: string
          workflow_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_approval_policies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_capability_policies: {
        Row: {
          allow_model_processing: boolean
          capability_version_id: string
          company_id: string
          created_at: string
          enabled: boolean
          id: string
          max_bytes: number
          max_rows: number
          minimum_role: string
          require_human_approval: boolean
          updated_at: string
          updated_by: string
        }
        Insert: {
          allow_model_processing?: boolean
          capability_version_id: string
          company_id: string
          created_at?: string
          enabled?: boolean
          id?: string
          max_bytes?: number
          max_rows?: number
          minimum_role?: string
          require_human_approval?: boolean
          updated_at?: string
          updated_by: string
        }
        Update: {
          allow_model_processing?: boolean
          capability_version_id?: string
          company_id?: string
          created_at?: string
          enabled?: boolean
          id?: string
          max_bytes?: number
          max_rows?: number
          minimum_role?: string
          require_human_approval?: boolean
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_capability_policies_capability_version_id_fkey"
            columns: ["capability_version_id"]
            isOneToOne: false
            referencedRelation: "capability_definition_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_capability_policies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_connector_capability_grants: {
        Row: {
          capability_version_id: string
          company_id: string
          granted_at: string
          granted_by: string
          id: string
          installation_id: string
          revoked_at: string | null
          revoked_by: string | null
          status: string
        }
        Insert: {
          capability_version_id: string
          company_id: string
          granted_at?: string
          granted_by: string
          id?: string
          installation_id: string
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
        }
        Update: {
          capability_version_id?: string
          company_id?: string
          granted_at?: string
          granted_by?: string
          id?: string
          installation_id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_connector_capability_gr_installation_id_company_id_fkey"
            columns: ["installation_id", "company_id"]
            isOneToOne: false
            referencedRelation: "company_connector_installations"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "company_connector_capability_grants_capability_version_id_fkey"
            columns: ["capability_version_id"]
            isOneToOne: false
            referencedRelation: "capability_definition_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_connector_capability_grants_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_connector_health: {
        Row: {
          checked_at: string
          company_id: string
          details: Json
          installation_id: string
          observed_schema_hash: string | null
          status: string
        }
        Insert: {
          checked_at?: string
          company_id: string
          details?: Json
          installation_id: string
          observed_schema_hash?: string | null
          status?: string
        }
        Update: {
          checked_at?: string
          company_id?: string
          details?: Json
          installation_id?: string
          observed_schema_hash?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_connector_health_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_connector_health_installation_id_company_id_fkey"
            columns: ["installation_id", "company_id"]
            isOneToOne: true
            referencedRelation: "company_connector_installations"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      company_connector_installations: {
        Row: {
          company_id: string
          connector_definition_id: string
          connector_version_id: string
          created_at: string
          display_name: string
          id: string
          installed_by: string
          status: string
          updated_at: string
        }
        Insert: {
          company_id: string
          connector_definition_id: string
          connector_version_id: string
          created_at?: string
          display_name: string
          id?: string
          installed_by: string
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          connector_definition_id?: string
          connector_version_id?: string
          created_at?: string
          display_name?: string
          id?: string
          installed_by?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_connector_installatio_connector_version_id_connect_fkey"
            columns: ["connector_version_id", "connector_definition_id"]
            isOneToOne: false
            referencedRelation: "connector_definition_versions"
            referencedColumns: ["id", "connector_definition_id"]
          },
          {
            foreignKeyName: "company_connector_installations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_connector_installations_connector_definition_id_fkey"
            columns: ["connector_definition_id"]
            isOneToOne: false
            referencedRelation: "connector_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      company_invitation_events: {
        Row: {
          actor_user_id: string | null
          company_id: string
          created_at: string
          event_type: string
          id: string
          invitation_id: string
          invitation_version: number
        }
        Insert: {
          actor_user_id?: string | null
          company_id: string
          created_at?: string
          event_type: string
          id?: string
          invitation_id: string
          invitation_version: number
        }
        Update: {
          actor_user_id?: string | null
          company_id?: string
          created_at?: string
          event_type?: string
          id?: string
          invitation_id?: string
          invitation_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_invitation_events_invitation_id_company_id_fkey"
            columns: ["invitation_id", "company_id"]
            isOneToOne: false
            referencedRelation: "company_invitations"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      company_invitation_tokens: {
        Row: {
          company_id: string
          consumed_at: string | null
          expires_at: string
          id: string
          invitation_id: string
          issued_at: string
          state: string
          token_digest: string
          version: number
        }
        Insert: {
          company_id: string
          consumed_at?: string | null
          expires_at: string
          id?: string
          invitation_id: string
          issued_at?: string
          state?: string
          token_digest: string
          version: number
        }
        Update: {
          company_id?: string
          consumed_at?: string | null
          expires_at?: string
          id?: string
          invitation_id?: string
          issued_at?: string
          state?: string
          token_digest?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_invitation_tokens_invitation_id_company_id_fkey"
            columns: ["invitation_id", "company_id"]
            isOneToOne: false
            referencedRelation: "company_invitations"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      company_invitations: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          company_id: string
          created_at: string
          delivery_id: string | null
          expires_at: string
          id: string
          inviter_user_id: string
          issued_at: string
          recipient_email: string
          recipient_hash: string
          revoked_at: string | null
          state: string
          updated_at: string
          version: number
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          company_id: string
          created_at?: string
          delivery_id?: string | null
          expires_at: string
          id: string
          inviter_user_id: string
          issued_at?: string
          recipient_email: string
          recipient_hash: string
          revoked_at?: string | null
          state?: string
          updated_at?: string
          version?: number
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          company_id?: string
          created_at?: string
          delivery_id?: string | null
          expires_at?: string
          id?: string
          inviter_user_id?: string
          issued_at?: string
          recipient_email?: string
          recipient_hash?: string
          revoked_at?: string | null
          state?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_invitations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_invitations_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "email_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_invitations_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "email_delivery_owner_status"
            referencedColumns: ["id"]
          },
        ]
      }
      company_membership_events: {
        Row: {
          action: string
          actor_user_id: string
          company_id: string
          created_at: string
          id: string
          membership_id: string
          next_role: string
          next_status: string
          previous_role: string | null
          previous_status: string | null
          target_user_id: string
        }
        Insert: {
          action: string
          actor_user_id: string
          company_id: string
          created_at?: string
          id?: string
          membership_id: string
          next_role: string
          next_status: string
          previous_role?: string | null
          previous_status?: string | null
          target_user_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string
          company_id?: string
          created_at?: string
          id?: string
          membership_id?: string
          next_role?: string
          next_status?: string
          previous_role?: string | null
          previous_status?: string | null
          target_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_membership_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_membership_events_membership_id_company_id_fkey"
            columns: ["membership_id", "company_id"]
            isOneToOne: false
            referencedRelation: "company_memberships"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      company_memberships: {
        Row: {
          company_id: string
          created_at: string
          id: string
          role: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          role: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          role?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_memberships_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_policy_decisions: {
        Row: {
          action_draft_id: string | null
          approval_policy_id: string | null
          approval_policy_snapshot: Json
          company_id: string
          created_at: string
          effect: string
          evaluation_context: Json
          evaluation_key: string
          execution_mode: string
          id: string
          permission: string
          policy_version: string
          principal_id: string
          principal_snapshot: Json
          reason: string
          workflow_run_id: string | null
        }
        Insert: {
          action_draft_id?: string | null
          approval_policy_id?: string | null
          approval_policy_snapshot?: Json
          company_id: string
          created_at?: string
          effect: string
          evaluation_context: Json
          evaluation_key: string
          execution_mode: string
          id?: string
          permission: string
          policy_version: string
          principal_id: string
          principal_snapshot: Json
          reason: string
          workflow_run_id?: string | null
        }
        Update: {
          action_draft_id?: string | null
          approval_policy_id?: string | null
          approval_policy_snapshot?: Json
          company_id?: string
          created_at?: string
          effect?: string
          evaluation_context?: Json
          evaluation_key?: string
          execution_mode?: string
          id?: string
          permission?: string
          policy_version?: string
          principal_id?: string
          principal_snapshot?: Json
          reason?: string
          workflow_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_policy_decisions_action_draft_id_company_id_fkey"
            columns: ["action_draft_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_action_drafts"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "company_policy_decisions_approval_policy_id_company_id_fkey"
            columns: ["approval_policy_id", "company_id"]
            isOneToOne: false
            referencedRelation: "company_approval_policies"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "company_policy_decisions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_policy_decisions_principal_id_company_id_fkey"
            columns: ["principal_id", "company_id"]
            isOneToOne: false
            referencedRelation: "company_principals"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "company_policy_decisions_workflow_run_id_company_id_fkey"
            columns: ["workflow_run_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      company_principals: {
        Row: {
          capabilities: string[]
          company_id: string
          created_at: string
          delegated_by_user_id: string | null
          display_name: string | null
          id: string
          membership_id: string | null
          principal_key: string | null
          principal_type: string
          state: string
          updated_at: string
        }
        Insert: {
          capabilities?: string[]
          company_id: string
          created_at?: string
          delegated_by_user_id?: string | null
          display_name?: string | null
          id?: string
          membership_id?: string | null
          principal_key?: string | null
          principal_type: string
          state?: string
          updated_at?: string
        }
        Update: {
          capabilities?: string[]
          company_id?: string
          created_at?: string
          delegated_by_user_id?: string | null
          display_name?: string | null
          id?: string
          membership_id?: string | null
          principal_key?: string | null
          principal_type?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_principals_company_id_delegated_by_user_id_fkey"
            columns: ["company_id", "delegated_by_user_id"]
            isOneToOne: false
            referencedRelation: "company_memberships"
            referencedColumns: ["company_id", "user_id"]
          },
          {
            foreignKeyName: "company_principals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_principals_membership_id_company_id_fkey"
            columns: ["membership_id", "company_id"]
            isOneToOne: false
            referencedRelation: "company_memberships"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      connection_imports: {
        Row: {
          connection: string
          error_message: string | null
          filename: string | null
          id: string
          imported_at: string
          owner_id: string
          owner_type: string
          pipeline_rows_created: number
          pipeline_rows_updated: number
          rows_added: number
          rows_skipped_duplicate: number
          rows_skipped_unsupported: number
          status: string
        }
        Insert: {
          connection: string
          error_message?: string | null
          filename?: string | null
          id?: string
          imported_at?: string
          owner_id: string
          owner_type?: string
          pipeline_rows_created?: number
          pipeline_rows_updated?: number
          rows_added?: number
          rows_skipped_duplicate?: number
          rows_skipped_unsupported?: number
          status: string
        }
        Update: {
          connection?: string
          error_message?: string | null
          filename?: string | null
          id?: string
          imported_at?: string
          owner_id?: string
          owner_type?: string
          pipeline_rows_created?: number
          pipeline_rows_updated?: number
          rows_added?: number
          rows_skipped_duplicate?: number
          rows_skipped_unsupported?: number
          status?: string
        }
        Relationships: []
      }
      connector_capability_offerings: {
        Row: {
          capability_version_id: string
          connector_version_id: string
          created_at: string
          provider_operation: string
        }
        Insert: {
          capability_version_id: string
          connector_version_id: string
          created_at?: string
          provider_operation: string
        }
        Update: {
          capability_version_id?: string
          connector_version_id?: string
          created_at?: string
          provider_operation?: string
        }
        Relationships: [
          {
            foreignKeyName: "connector_capability_offerings_capability_version_id_fkey"
            columns: ["capability_version_id"]
            isOneToOne: false
            referencedRelation: "capability_definition_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_capability_offerings_connector_version_id_fkey"
            columns: ["connector_version_id"]
            isOneToOne: false
            referencedRelation: "connector_definition_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_definition_versions: {
        Row: {
          connector_definition_id: string
          created_at: string
          id: string
          manifest: Json
          manifest_hash: string
          schema_hash: string
          status: string
          version: string
        }
        Insert: {
          connector_definition_id: string
          created_at?: string
          id?: string
          manifest: Json
          manifest_hash: string
          schema_hash: string
          status?: string
          version: string
        }
        Update: {
          connector_definition_id?: string
          created_at?: string
          id?: string
          manifest?: Json
          manifest_hash?: string
          schema_hash?: string
          status?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "connector_definition_versions_connector_definition_id_fkey"
            columns: ["connector_definition_id"]
            isOneToOne: false
            referencedRelation: "connector_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_definitions: {
        Row: {
          connector_key: string
          created_at: string
          description: string
          display_name: string
          id: string
          status: string
        }
        Insert: {
          connector_key: string
          created_at?: string
          description?: string
          display_name: string
          id?: string
          status?: string
        }
        Update: {
          connector_key?: string
          created_at?: string
          description?: string
          display_name?: string
          id?: string
          status?: string
        }
        Relationships: []
      }
      context_index_events: {
        Row: {
          attempt_count: number | null
          company_id: string
          cost_adjustment_microunits: number
          created_at: string
          estimated_cost_microunits: number
          event_type: string
          id: number
          job_id: string | null
          operation: string | null
          outbox_id: string | null
          provider: string
          safe_error_code: string | null
        }
        Insert: {
          attempt_count?: number | null
          company_id: string
          cost_adjustment_microunits?: number
          created_at?: string
          estimated_cost_microunits?: number
          event_type: string
          id?: never
          job_id?: string | null
          operation?: string | null
          outbox_id?: string | null
          provider: string
          safe_error_code?: string | null
        }
        Update: {
          attempt_count?: number | null
          company_id?: string
          cost_adjustment_microunits?: number
          created_at?: string
          estimated_cost_microunits?: number
          event_type?: string
          id?: never
          job_id?: string | null
          operation?: string | null
          outbox_id?: string | null
          provider?: string
          safe_error_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "context_index_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "context_index_events_job_id_company_id_fkey"
            columns: ["job_id", "company_id"]
            isOneToOne: false
            referencedRelation: "context_index_jobs"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "context_index_events_outbox_id_company_id_fkey"
            columns: ["outbox_id", "company_id"]
            isOneToOne: false
            referencedRelation: "context_index_outbox"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      context_index_jobs: {
        Row: {
          actor_kind: string
          company_id: string
          completed_at: string | null
          completed_count: number
          created_at: string
          eligible_count: number
          failed_count: number
          id: string
          mode: string
          policy_hash: string
          provider: string
          query_hash: string
          queued_count: number
          requested_limit: number
          snapshot_hash: string
          started_at: string
          status: string
        }
        Insert: {
          actor_kind?: string
          company_id: string
          completed_at?: string | null
          completed_count?: number
          created_at?: string
          eligible_count: number
          failed_count?: number
          id?: string
          mode: string
          policy_hash: string
          provider: string
          query_hash: string
          queued_count?: number
          requested_limit: number
          snapshot_hash: string
          started_at?: string
          status: string
        }
        Update: {
          actor_kind?: string
          company_id?: string
          completed_at?: string | null
          completed_count?: number
          created_at?: string
          eligible_count?: number
          failed_count?: number
          id?: string
          mode?: string
          policy_hash?: string
          provider?: string
          query_hash?: string
          queued_count?: number
          requested_limit?: number
          snapshot_hash?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "context_index_jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      context_index_ledger: {
        Row: {
          attempt_count: number
          canonical_record_id: string
          canonical_version: string
          company_id: string
          content_hash: string
          deletion_confirmed_at: string | null
          deletion_requested_at: string | null
          first_queued_at: string
          id: string
          last_error_at: string | null
          last_indexed_at: string | null
          last_verified_at: string | null
          policy_hash: string
          policy_version: number
          provider: string
          provider_document_id: string | null
          record_type: string
          safe_error_code: string | null
          source_key: string
          stable_custom_id: string
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          canonical_record_id: string
          canonical_version: string
          company_id: string
          content_hash: string
          deletion_confirmed_at?: string | null
          deletion_requested_at?: string | null
          first_queued_at?: string
          id?: string
          last_error_at?: string | null
          last_indexed_at?: string | null
          last_verified_at?: string | null
          policy_hash: string
          policy_version: number
          provider: string
          provider_document_id?: string | null
          record_type: string
          safe_error_code?: string | null
          source_key: string
          stable_custom_id: string
          status: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          canonical_record_id?: string
          canonical_version?: string
          company_id?: string
          content_hash?: string
          deletion_confirmed_at?: string | null
          deletion_requested_at?: string | null
          first_queued_at?: string
          id?: string
          last_error_at?: string | null
          last_indexed_at?: string | null
          last_verified_at?: string | null
          policy_hash?: string
          policy_version?: number
          provider?: string
          provider_document_id?: string | null
          record_type?: string
          safe_error_code?: string | null
          source_key?: string
          stable_custom_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "context_index_ledger_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      context_index_operation_audits: {
        Row: {
          actor_kind: string
          canary_record_limit: number
          company_id: string
          created_at: string
          daily_cost_cap_microunits: number
          daily_operation_cap: number
          id: string
          previous_canary_record_limit: number
          previous_daily_operation_cap: number
          previous_readiness: string
          previous_worker_enabled: boolean
          provider: string
          readiness: string
          reason: string
          requests_per_minute: number
          worker_enabled: boolean
        }
        Insert: {
          actor_kind?: string
          canary_record_limit: number
          company_id: string
          created_at?: string
          daily_cost_cap_microunits: number
          daily_operation_cap: number
          id?: string
          previous_canary_record_limit: number
          previous_daily_operation_cap: number
          previous_readiness: string
          previous_worker_enabled: boolean
          provider: string
          readiness: string
          reason: string
          requests_per_minute: number
          worker_enabled: boolean
        }
        Update: {
          actor_kind?: string
          canary_record_limit?: number
          company_id?: string
          created_at?: string
          daily_cost_cap_microunits?: number
          daily_operation_cap?: number
          id?: string
          previous_canary_record_limit?: number
          previous_daily_operation_cap?: number
          previous_readiness?: string
          previous_worker_enabled?: boolean
          provider?: string
          readiness?: string
          reason?: string
          requests_per_minute?: number
          worker_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "context_index_operation_audits_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      context_index_operation_controls: {
        Row: {
          canary_record_limit: number
          company_id: string
          daily_cost_cap_microunits: number
          daily_operation_cap: number
          estimated_operation_cost_microunits: number
          max_attempts: number
          provider: string
          provider_health_checked_at: string | null
          provider_health_detail_code: string | null
          provider_health_status: string
          requests_per_minute: number
          updated_at: string
          worker_enabled: boolean
        }
        Insert: {
          canary_record_limit?: number
          company_id: string
          daily_cost_cap_microunits?: number
          daily_operation_cap?: number
          estimated_operation_cost_microunits?: number
          max_attempts?: number
          provider?: string
          provider_health_checked_at?: string | null
          provider_health_detail_code?: string | null
          provider_health_status?: string
          requests_per_minute?: number
          updated_at?: string
          worker_enabled?: boolean
        }
        Update: {
          canary_record_limit?: number
          company_id?: string
          daily_cost_cap_microunits?: number
          daily_operation_cap?: number
          estimated_operation_cost_microunits?: number
          max_attempts?: number
          provider?: string
          provider_health_checked_at?: string | null
          provider_health_detail_code?: string | null
          provider_health_status?: string
          requests_per_minute?: number
          updated_at?: string
          worker_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "context_index_operation_controls_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      context_index_outbox: {
        Row: {
          attempt_count: number
          available_at: string
          canonical_record_id: string
          canonical_version: string
          company_id: string
          content_hash: string
          created_at: string
          delivery_state: string
          dispatch_started_at: string | null
          id: string
          idempotency_key: string
          job_id: string | null
          lease_expires_at: string | null
          lease_id: string | null
          lease_owner: string | null
          operation: string
          policy_hash: string
          policy_version: number
          poll_attempt_count: number
          provider: string
          provider_accepted_at: string | null
          provider_checked_at: string | null
          provider_document_id: string | null
          provider_processing_status: string | null
          provider_result_document_id: string | null
          record_type: string
          reserved_cost_microunits: number
          safe_error_code: string | null
          source_key: string
          stable_custom_id: string
          terminal_at: string | null
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          canonical_record_id: string
          canonical_version: string
          company_id: string
          content_hash: string
          created_at?: string
          delivery_state?: string
          dispatch_started_at?: string | null
          id?: string
          idempotency_key: string
          job_id?: string | null
          lease_expires_at?: string | null
          lease_id?: string | null
          lease_owner?: string | null
          operation: string
          policy_hash: string
          policy_version: number
          poll_attempt_count?: number
          provider: string
          provider_accepted_at?: string | null
          provider_checked_at?: string | null
          provider_document_id?: string | null
          provider_processing_status?: string | null
          provider_result_document_id?: string | null
          record_type: string
          reserved_cost_microunits?: number
          safe_error_code?: string | null
          source_key: string
          stable_custom_id: string
          terminal_at?: string | null
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          canonical_record_id?: string
          canonical_version?: string
          company_id?: string
          content_hash?: string
          created_at?: string
          delivery_state?: string
          dispatch_started_at?: string | null
          id?: string
          idempotency_key?: string
          job_id?: string | null
          lease_expires_at?: string | null
          lease_id?: string | null
          lease_owner?: string | null
          operation?: string
          policy_hash?: string
          policy_version?: number
          poll_attempt_count?: number
          provider?: string
          provider_accepted_at?: string | null
          provider_checked_at?: string | null
          provider_document_id?: string | null
          provider_processing_status?: string | null
          provider_result_document_id?: string | null
          record_type?: string
          reserved_cost_microunits?: number
          safe_error_code?: string | null
          source_key?: string
          stable_custom_id?: string
          terminal_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "context_index_outbox_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "context_index_outbox_job_id_company_id_fkey"
            columns: ["job_id", "company_id"]
            isOneToOne: false
            referencedRelation: "context_index_jobs"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      context_index_tombstones: {
        Row: {
          canonical_record_id: string
          company_id: string
          confirmed_at: string | null
          delete_outbox_id: string
          deleted_at: string
          deletion_reason: string
          id: string
          provider: string
          provider_document_id: string
          stable_custom_id: string
        }
        Insert: {
          canonical_record_id: string
          company_id: string
          confirmed_at?: string | null
          delete_outbox_id: string
          deleted_at?: string
          deletion_reason?: string
          id?: string
          provider: string
          provider_document_id: string
          stable_custom_id: string
        }
        Update: {
          canonical_record_id?: string
          company_id?: string
          confirmed_at?: string | null
          delete_outbox_id?: string
          deleted_at?: string
          deletion_reason?: string
          id?: string
          provider?: string
          provider_document_id?: string
          stable_custom_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "context_index_tombstones_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "context_index_tombstones_delete_outbox_id_company_id_fkey"
            columns: ["delete_outbox_id", "company_id"]
            isOneToOne: false
            referencedRelation: "context_index_outbox"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      context_indexing_policy_versions: {
        Row: {
          approved_field_paths: string[]
          classification: string
          company_id: string
          created_at: string
          created_by: string
          id: string
          indexing_enabled: boolean
          maximum_content_bytes: number
          policy_version: number
          projection_version: number
          reason: string
          record_type: string
          retention_days: number
          source_key: string
        }
        Insert: {
          approved_field_paths?: string[]
          classification: string
          company_id: string
          created_at?: string
          created_by: string
          id?: string
          indexing_enabled?: boolean
          maximum_content_bytes?: number
          policy_version: number
          projection_version: number
          reason: string
          record_type: string
          retention_days: number
          source_key: string
        }
        Update: {
          approved_field_paths?: string[]
          classification?: string
          company_id?: string
          created_at?: string
          created_by?: string
          id?: string
          indexing_enabled?: boolean
          maximum_content_bytes?: number
          policy_version?: number
          projection_version?: number
          reason?: string
          record_type?: string
          retention_days?: number
          source_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "context_indexing_policy_versions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      context_workspace_setting_audits: {
        Row: {
          actor_id: string
          change_kind: string
          company_id: string
          configuration_version: number
          created_at: string
          id: string
          previous_provider: string | null
          previous_readiness: string | null
          previous_sandbox_enabled: boolean | null
          provider: string
          readiness: string
          reason: string
          sandbox_enabled: boolean
        }
        Insert: {
          actor_id: string
          change_kind: string
          company_id: string
          configuration_version: number
          created_at?: string
          id?: string
          previous_provider?: string | null
          previous_readiness?: string | null
          previous_sandbox_enabled?: boolean | null
          provider: string
          readiness: string
          reason: string
          sandbox_enabled: boolean
        }
        Update: {
          actor_id?: string
          change_kind?: string
          company_id?: string
          configuration_version?: number
          created_at?: string
          id?: string
          previous_provider?: string | null
          previous_readiness?: string | null
          previous_sandbox_enabled?: boolean | null
          provider?: string
          readiness?: string
          reason?: string
          sandbox_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "context_workspace_setting_audits_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      context_workspace_settings: {
        Row: {
          company_id: string
          configuration_version: number
          provider: string
          readiness: string
          sandbox_enabled: boolean
          updated_at: string
          updated_by: string
        }
        Insert: {
          company_id: string
          configuration_version?: number
          provider?: string
          readiness?: string
          sandbox_enabled?: boolean
          updated_at?: string
          updated_by: string
        }
        Update: {
          company_id?: string
          configuration_version?: number
          provider?: string
          readiness?: string
          sandbox_enabled?: boolean
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "context_workspace_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      email_deliveries: {
        Row: {
          attempt_count: number
          claim_expires_at: string | null
          claim_token: string | null
          company_id: string
          created_at: string
          id: string
          idempotency_key: string
          last_error_category: string | null
          next_attempt_at: string
          payload_reference: string
          provider_email_id: string | null
          provider_event_at: string | null
          recipient_email: string
          recipient_hash: string
          state: string
          template_key: string
          template_version: string
          terminal_at: string | null
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          claim_expires_at?: string | null
          claim_token?: string | null
          company_id: string
          created_at?: string
          id?: string
          idempotency_key: string
          last_error_category?: string | null
          next_attempt_at?: string
          payload_reference: string
          provider_email_id?: string | null
          provider_event_at?: string | null
          recipient_email: string
          recipient_hash: string
          state?: string
          template_key: string
          template_version: string
          terminal_at?: string | null
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          claim_expires_at?: string | null
          claim_token?: string | null
          company_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          last_error_category?: string | null
          next_attempt_at?: string
          payload_reference?: string
          provider_email_id?: string | null
          provider_event_at?: string | null
          recipient_email?: string
          recipient_hash?: string
          state?: string
          template_key?: string
          template_version?: string
          terminal_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_deliveries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      email_delivery_attempts: {
        Row: {
          attempt_number: number
          claim_token: string
          company_id: string
          delivery_id: string
          error_category: string | null
          finished_at: string | null
          id: string
          provider_email_id: string | null
          started_at: string
          state: string
        }
        Insert: {
          attempt_number: number
          claim_token: string
          company_id: string
          delivery_id: string
          error_category?: string | null
          finished_at?: string | null
          id?: string
          provider_email_id?: string | null
          started_at?: string
          state?: string
        }
        Update: {
          attempt_number?: number
          claim_token?: string
          company_id?: string
          delivery_id?: string
          error_category?: string | null
          finished_at?: string | null
          id?: string
          provider_email_id?: string | null
          started_at?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_delivery_attempts_delivery_id_company_id_fkey"
            columns: ["delivery_id", "company_id"]
            isOneToOne: false
            referencedRelation: "email_deliveries"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "email_delivery_attempts_delivery_id_company_id_fkey"
            columns: ["delivery_id", "company_id"]
            isOneToOne: false
            referencedRelation: "email_delivery_owner_status"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      email_delivery_events: {
        Row: {
          applied: boolean
          company_id: string
          delivery_id: string
          event_type: string
          id: string
          occurred_at: string
          provider_email_id: string
          provider_event_id: string
          received_at: string
          safe_reason: string | null
        }
        Insert: {
          applied?: boolean
          company_id: string
          delivery_id: string
          event_type: string
          id?: string
          occurred_at: string
          provider_email_id: string
          provider_event_id: string
          received_at?: string
          safe_reason?: string | null
        }
        Update: {
          applied?: boolean
          company_id?: string
          delivery_id?: string
          event_type?: string
          id?: string
          occurred_at?: string
          provider_email_id?: string
          provider_event_id?: string
          received_at?: string
          safe_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_delivery_events_delivery_id_company_id_fkey"
            columns: ["delivery_id", "company_id"]
            isOneToOne: false
            referencedRelation: "email_deliveries"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "email_delivery_events_delivery_id_company_id_fkey"
            columns: ["delivery_id", "company_id"]
            isOneToOne: false
            referencedRelation: "email_delivery_owner_status"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      email_suppressions: {
        Row: {
          active: boolean
          company_id: string
          created_at: string
          id: string
          reason: string
          recipient_hash: string
          source_delivery_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          company_id: string
          created_at?: string
          id?: string
          reason: string
          recipient_hash: string
          source_delivery_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          company_id?: string
          created_at?: string
          id?: string
          reason?: string
          recipient_hash?: string
          source_delivery_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_suppressions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_suppressions_source_delivery_id_company_id_fkey"
            columns: ["source_delivery_id", "company_id"]
            isOneToOne: false
            referencedRelation: "email_deliveries"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "email_suppressions_source_delivery_id_company_id_fkey"
            columns: ["source_delivery_id", "company_id"]
            isOneToOne: false
            referencedRelation: "email_delivery_owner_status"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      external_record_links: {
        Row: {
          company_id: string
          created_at: string
          from_record_id: string
          id: string
          relationship: string
          to_record_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          from_record_id: string
          id?: string
          relationship: string
          to_record_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          from_record_id?: string
          id?: string
          relationship?: string
          to_record_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_record_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_record_links_from_record_id_company_id_fkey"
            columns: ["from_record_id", "company_id"]
            isOneToOne: false
            referencedRelation: "external_records"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "external_record_links_to_record_id_company_id_fkey"
            columns: ["to_record_id", "company_id"]
            isOneToOne: false
            referencedRelation: "external_records"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      external_records: {
        Row: {
          company_id: string
          created_at: string
          external_id: string
          id: string
          payload: Json
          pulled_at: string
          record_type: string
          source_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          external_id: string
          id?: string
          payload?: Json
          pulled_at?: string
          record_type: string
          source_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          external_id?: string
          id?: string
          payload?: Json
          pulled_at?: string
          record_type?: string
          source_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_records_source_id_company_id_fkey"
            columns: ["source_id", "company_id"]
            isOneToOne: false
            referencedRelation: "external_sources"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      external_sources: {
        Row: {
          company_id: string
          config: Json
          created_at: string
          id: string
          kind: string
          last_sync_error: string | null
          last_synced_at: string | null
          name: string
          source_key: string
          sync_status: string
          updated_at: string
        }
        Insert: {
          company_id: string
          config?: Json
          created_at?: string
          id?: string
          kind: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          name: string
          source_key: string
          sync_status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          config?: Json
          created_at?: string
          id?: string
          kind?: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          name?: string
          source_key?: string
          sync_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_sources_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      pages: {
        Row: {
          collection_id: string | null
          created_at: string
          deleted_at: string | null
          document: Json | null
          emoji: string | null
          id: string
          owner_id: string
          owner_type: string
          page_type: string
          sort_index: number
          title: string
          updated_at: string
        }
        Insert: {
          collection_id?: string | null
          created_at?: string
          deleted_at?: string | null
          document?: Json | null
          emoji?: string | null
          id?: string
          owner_id: string
          owner_type?: string
          page_type: string
          sort_index?: number
          title?: string
          updated_at?: string
        }
        Update: {
          collection_id?: string | null
          created_at?: string
          deleted_at?: string | null
          document?: Json | null
          emoji?: string | null
          id?: string
          owner_id?: string
          owner_type?: string
          page_type?: string
          sort_index?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pages_collection_fk"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          display_name: string | null
          first_name: string | null
          last_name: string | null
          theme_accent: string
          theme_mode: string
          timezone: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          display_name?: string | null
          first_name?: string | null
          last_name?: string | null
          theme_accent?: string
          theme_mode?: string
          timezone?: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          display_name?: string | null
          first_name?: string | null
          last_name?: string | null
          theme_accent?: string
          theme_mode?: string
          timezone?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      provider_model_rates: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          effective_from: string
          effective_to: string | null
          id: string
          metric_name: string
          model: string
          price_per_unit: number
          provider: string
          quantity_per_unit: number
          rate_version: string
          source_reference: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency: string
          effective_from: string
          effective_to?: string | null
          id?: string
          metric_name: string
          model: string
          price_per_unit: number
          provider: string
          quantity_per_unit: number
          rate_version: string
          source_reference: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          metric_name?: string
          model?: string
          price_per_unit?: number
          provider?: string
          quantity_per_unit?: number
          rate_version?: string
          source_reference?: string
        }
        Relationships: []
      }
      provider_usage_events: {
        Row: {
          cached_input_tokens: number
          company_id: string
          completeness: string
          created_at: string
          id: string
          idempotency_key: string
          input_tokens: number
          measured_at: string
          model: string
          output_tokens: number
          payload_digest: string
          provider: string
          reasoning_output_tokens: number
          recorded_by: string
          request_count: number
          run_id: string | null
          source_operation: string
          total_tokens: number
          trace_id: string | null
          workflow_run_id: string | null
        }
        Insert: {
          cached_input_tokens?: number
          company_id: string
          completeness: string
          created_at?: string
          id?: string
          idempotency_key: string
          input_tokens?: number
          measured_at: string
          model: string
          output_tokens?: number
          payload_digest: string
          provider: string
          reasoning_output_tokens?: number
          recorded_by: string
          request_count?: number
          run_id?: string | null
          source_operation: string
          total_tokens?: number
          trace_id?: string | null
          workflow_run_id?: string | null
        }
        Update: {
          cached_input_tokens?: number
          company_id?: string
          completeness?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          input_tokens?: number
          measured_at?: string
          model?: string
          output_tokens?: number
          payload_digest?: string
          provider?: string
          reasoning_output_tokens?: number
          recorded_by?: string
          request_count?: number
          run_id?: string | null
          source_operation?: string
          total_tokens?: number
          trace_id?: string | null
          workflow_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_usage_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_usage_events_workflow_run_id_company_id_fkey"
            columns: ["workflow_run_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      workflow_action_attempts: {
        Row: {
          action_definition_id: string | null
          action_draft_id: string
          action_type: string
          attempt_number: number
          company_id: string
          completed_at: string | null
          created_at: string
          decision_id: string
          effect_state: string
          error_message: string | null
          execution_token_id: string
          id: string
          idempotency_key: string
          mock_external_id: string | null
          mode: string
          provider_idempotency_key: string | null
          provider_reference: string | null
          reconciliation_required: boolean
          request_hash: string | null
          request_payload: Json
          response_hash: string | null
          result_payload: Json
          retry_class: string
          status: string
          tool_definition_id: string | null
          workflow_item_id: string
          workflow_run_id: string
        }
        Insert: {
          action_definition_id?: string | null
          action_draft_id: string
          action_type: string
          attempt_number?: number
          company_id: string
          completed_at?: string | null
          created_at?: string
          decision_id: string
          effect_state?: string
          error_message?: string | null
          execution_token_id: string
          id?: string
          idempotency_key: string
          mock_external_id?: string | null
          mode: string
          provider_idempotency_key?: string | null
          provider_reference?: string | null
          reconciliation_required?: boolean
          request_hash?: string | null
          request_payload?: Json
          response_hash?: string | null
          result_payload?: Json
          retry_class?: string
          status: string
          tool_definition_id?: string | null
          workflow_item_id: string
          workflow_run_id: string
        }
        Update: {
          action_definition_id?: string | null
          action_draft_id?: string
          action_type?: string
          attempt_number?: number
          company_id?: string
          completed_at?: string | null
          created_at?: string
          decision_id?: string
          effect_state?: string
          error_message?: string | null
          execution_token_id?: string
          id?: string
          idempotency_key?: string
          mock_external_id?: string | null
          mode?: string
          provider_idempotency_key?: string | null
          provider_reference?: string | null
          reconciliation_required?: boolean
          request_hash?: string | null
          request_payload?: Json
          response_hash?: string | null
          result_payload?: Json
          retry_class?: string
          status?: string
          tool_definition_id?: string | null
          workflow_item_id?: string
          workflow_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_action_attempts_action_definition_id_fkey"
            columns: ["action_definition_id"]
            isOneToOne: false
            referencedRelation: "agent_action_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_action_attempts_action_draft_id_fkey"
            columns: ["action_draft_id"]
            isOneToOne: false
            referencedRelation: "workflow_action_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_action_attempts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_action_attempts_decision_company_fkey"
            columns: ["decision_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_decisions"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_action_attempts_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "workflow_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_action_attempts_draft_company_fkey"
            columns: ["action_draft_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_action_drafts"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_action_attempts_execution_token_id_fkey"
            columns: ["execution_token_id"]
            isOneToOne: true
            referencedRelation: "workflow_execution_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_action_attempts_item_company_fkey"
            columns: ["workflow_item_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_items"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_action_attempts_run_company_fkey"
            columns: ["workflow_run_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_action_attempts_token_company_fkey"
            columns: ["execution_token_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_execution_tokens"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_action_attempts_tool_definition_id_fkey"
            columns: ["tool_definition_id"]
            isOneToOne: false
            referencedRelation: "agent_tool_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_action_attempts_workflow_item_id_fkey"
            columns: ["workflow_item_id"]
            isOneToOne: false
            referencedRelation: "workflow_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_action_attempts_workflow_run_id_fkey"
            columns: ["workflow_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_action_drafts: {
        Row: {
          action_type: string
          company_id: string
          created_at: string
          edit_policy: Json
          evidence_snapshot_id: string
          id: string
          payload: Json
          payload_hash: string
          recommendation_run_id: string
          status: string
          updated_at: string
          workflow_item_id: string
          workflow_run_id: string
        }
        Insert: {
          action_type: string
          company_id: string
          created_at?: string
          edit_policy?: Json
          evidence_snapshot_id: string
          id?: string
          payload?: Json
          payload_hash: string
          recommendation_run_id: string
          status: string
          updated_at?: string
          workflow_item_id: string
          workflow_run_id: string
        }
        Update: {
          action_type?: string
          company_id?: string
          created_at?: string
          edit_policy?: Json
          evidence_snapshot_id?: string
          id?: string
          payload?: Json
          payload_hash?: string
          recommendation_run_id?: string
          status?: string
          updated_at?: string
          workflow_item_id?: string
          workflow_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_action_drafts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_action_drafts_evidence_company_fkey"
            columns: ["evidence_snapshot_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_evidence_snapshots"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_action_drafts_evidence_snapshot_id_fkey"
            columns: ["evidence_snapshot_id"]
            isOneToOne: false
            referencedRelation: "workflow_evidence_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_action_drafts_item_company_fkey"
            columns: ["workflow_item_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_items"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_action_drafts_recommendation_company_fkey"
            columns: ["recommendation_run_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_recommendation_runs"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_action_drafts_recommendation_run_id_fkey"
            columns: ["recommendation_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_recommendation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_action_drafts_run_company_fkey"
            columns: ["workflow_run_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_action_drafts_workflow_item_id_fkey"
            columns: ["workflow_item_id"]
            isOneToOne: false
            referencedRelation: "workflow_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_action_drafts_workflow_run_id_fkey"
            columns: ["workflow_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_activation_events: {
        Row: {
          actor_id: string
          binding_snapshot_id: string
          company_id: string
          created_at: string
          event_type: string
          id: string
          previous_workflow_id: string | null
          workflow_id: string
          workflow_key: string
        }
        Insert: {
          actor_id: string
          binding_snapshot_id: string
          company_id: string
          created_at?: string
          event_type: string
          id?: string
          previous_workflow_id?: string | null
          workflow_id: string
          workflow_key: string
        }
        Update: {
          actor_id?: string
          binding_snapshot_id?: string
          company_id?: string
          created_at?: string
          event_type?: string
          id?: string
          previous_workflow_id?: string | null
          workflow_id?: string
          workflow_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_activation_events_binding_snapshot_id_company_id__fkey"
            columns: ["binding_snapshot_id", "company_id", "workflow_id"]
            isOneToOne: false
            referencedRelation: "workflow_binding_snapshots"
            referencedColumns: ["id", "company_id", "workflow_id"]
          },
          {
            foreignKeyName: "workflow_activation_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_activation_events_previous_workflow_id_company_id_fkey"
            columns: ["previous_workflow_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_workflows"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_activation_events_workflow_id_company_id_fkey"
            columns: ["workflow_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_workflows"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      workflow_activations: {
        Row: {
          activated_at: string
          activated_by: string
          activation_sequence: number
          binding_snapshot_id: string
          company_id: string
          workflow_id: string
          workflow_key: string
        }
        Insert: {
          activated_at?: string
          activated_by: string
          activation_sequence?: number
          binding_snapshot_id: string
          company_id: string
          workflow_id: string
          workflow_key: string
        }
        Update: {
          activated_at?: string
          activated_by?: string
          activation_sequence?: number
          binding_snapshot_id?: string
          company_id?: string
          workflow_id?: string
          workflow_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_activations_binding_snapshot_id_company_id_workfl_fkey"
            columns: ["binding_snapshot_id", "company_id", "workflow_id"]
            isOneToOne: false
            referencedRelation: "workflow_binding_snapshots"
            referencedColumns: ["id", "company_id", "workflow_id"]
          },
          {
            foreignKeyName: "workflow_activations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_activations_workflow_id_company_id_fkey"
            columns: ["workflow_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_workflows"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      workflow_audit_events: {
        Row: {
          actor_id: string | null
          actor_type: string
          company_id: string
          created_at: string
          event_type: string
          id: string
          payload: Json
          summary: string
          trace: Json
          workflow_item_id: string | null
          workflow_run_id: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_type: string
          company_id: string
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          summary: string
          trace?: Json
          workflow_item_id?: string | null
          workflow_run_id?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          company_id?: string
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          summary?: string
          trace?: Json
          workflow_item_id?: string | null
          workflow_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_audit_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_audit_events_workflow_item_id_fkey"
            columns: ["workflow_item_id"]
            isOneToOne: false
            referencedRelation: "workflow_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_audit_events_workflow_run_id_fkey"
            columns: ["workflow_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_binding_snapshot_events: {
        Row: {
          actor_id: string | null
          binding_snapshot_id: string
          company_id: string
          created_at: string
          event_type: string
          id: string
          reason: string
        }
        Insert: {
          actor_id?: string | null
          binding_snapshot_id: string
          company_id: string
          created_at?: string
          event_type: string
          id?: string
          reason: string
        }
        Update: {
          actor_id?: string | null
          binding_snapshot_id?: string
          company_id?: string
          created_at?: string
          event_type?: string
          id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_binding_snapshot_eve_binding_snapshot_id_company__fkey"
            columns: ["binding_snapshot_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_binding_snapshots"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_binding_snapshot_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_binding_snapshots: {
        Row: {
          company_id: string
          created_at: string
          created_by: string
          grant_digest: string
          id: string
          manifest_hash: string
          workflow_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by: string
          grant_digest: string
          id?: string
          manifest_hash: string
          workflow_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string
          grant_digest?: string
          id?: string
          manifest_hash?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_binding_snapshots_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_binding_snapshots_workflow_id_company_id_fkey"
            columns: ["workflow_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_workflows"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      workflow_capability_bindings: {
        Row: {
          binding_snapshot_id: string
          capability_version_id: string
          company_id: string
          created_at: string
          grant_id: string
          id: string
          requirement_key: string
        }
        Insert: {
          binding_snapshot_id: string
          capability_version_id: string
          company_id: string
          created_at?: string
          grant_id: string
          id?: string
          requirement_key: string
        }
        Update: {
          binding_snapshot_id?: string
          capability_version_id?: string
          company_id?: string
          created_at?: string
          grant_id?: string
          id?: string
          requirement_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_capability_bindings_binding_snapshot_id_company_i_fkey"
            columns: ["binding_snapshot_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_binding_snapshots"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_capability_bindings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_capability_bindings_grant_id_company_id_capabilit_fkey"
            columns: ["grant_id", "company_id", "capability_version_id"]
            isOneToOne: false
            referencedRelation: "company_connector_capability_grants"
            referencedColumns: ["id", "company_id", "capability_version_id"]
          },
        ]
      }
      workflow_context_packets: {
        Row: {
          company_id: string
          created_at: string
          facts: Json
          freshness_state: string
          id: string
          memory_refs: Json
          operational_context: Json | null
          sources: Json
          warnings: Json
          workflow_item_id: string
          workflow_run_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          facts?: Json
          freshness_state: string
          id?: string
          memory_refs?: Json
          operational_context?: Json | null
          sources?: Json
          warnings?: Json
          workflow_item_id: string
          workflow_run_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          facts?: Json
          freshness_state?: string
          id?: string
          memory_refs?: Json
          operational_context?: Json | null
          sources?: Json
          warnings?: Json
          workflow_item_id?: string
          workflow_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_context_packets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_context_packets_item_company_fkey"
            columns: ["workflow_item_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_items"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_context_packets_run_company_fkey"
            columns: ["workflow_run_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_context_packets_workflow_item_id_fkey"
            columns: ["workflow_item_id"]
            isOneToOne: false
            referencedRelation: "workflow_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_context_packets_workflow_run_id_fkey"
            columns: ["workflow_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_control_requests: {
        Row: {
          actor_id: string
          client_surface: string
          company_id: string
          created_at: string
          id: string
          input_hash: string
          langsmith_run_id: string | null
          langsmith_trace_id: string | null
          normalized_intent: Json
          parser_kind: string
          resolution_status: string
          risk_class: string
          updated_at: string
          workflow_item_id: string | null
          workflow_run_id: string | null
        }
        Insert: {
          actor_id: string
          client_surface: string
          company_id: string
          created_at?: string
          id?: string
          input_hash: string
          langsmith_run_id?: string | null
          langsmith_trace_id?: string | null
          normalized_intent: Json
          parser_kind: string
          resolution_status: string
          risk_class: string
          updated_at?: string
          workflow_item_id?: string | null
          workflow_run_id?: string | null
        }
        Update: {
          actor_id?: string
          client_surface?: string
          company_id?: string
          created_at?: string
          id?: string
          input_hash?: string
          langsmith_run_id?: string | null
          langsmith_trace_id?: string | null
          normalized_intent?: Json
          parser_kind?: string
          resolution_status?: string
          risk_class?: string
          updated_at?: string
          workflow_item_id?: string | null
          workflow_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_control_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_control_requests_item_company_fkey"
            columns: ["workflow_item_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_items"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_control_requests_run_company_fkey"
            columns: ["workflow_run_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      workflow_decision_outcomes: {
        Row: {
          company_id: string
          created_at: string
          decision_id: string
          expected_version: string
          prior_state: Json
          result_state: Json
          workflow_item_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          decision_id: string
          expected_version: string
          prior_state: Json
          result_state: Json
          workflow_item_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          decision_id?: string
          expected_version?: string
          prior_state?: Json
          result_state?: Json
          workflow_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_decision_outcomes_decision_id_company_id_fkey"
            columns: ["decision_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_decisions"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_decision_outcomes_workflow_item_id_company_id_fkey"
            columns: ["workflow_item_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_items"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      workflow_decisions: {
        Row: {
          action_draft_id: string | null
          actor_type: string
          company_id: string
          created_at: string
          decided_by: string | null
          decision: string
          edited_payload: Json | null
          id: string
          reason: string | null
          warnings_acknowledged: boolean
          workflow_item_id: string
          workflow_run_id: string
        }
        Insert: {
          action_draft_id?: string | null
          actor_type: string
          company_id: string
          created_at?: string
          decided_by?: string | null
          decision: string
          edited_payload?: Json | null
          id?: string
          reason?: string | null
          warnings_acknowledged?: boolean
          workflow_item_id: string
          workflow_run_id: string
        }
        Update: {
          action_draft_id?: string | null
          actor_type?: string
          company_id?: string
          created_at?: string
          decided_by?: string | null
          decision?: string
          edited_payload?: Json | null
          id?: string
          reason?: string | null
          warnings_acknowledged?: boolean
          workflow_item_id?: string
          workflow_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_decisions_action_draft_id_fkey"
            columns: ["action_draft_id"]
            isOneToOne: true
            referencedRelation: "workflow_action_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_decisions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_decisions_draft_company_fkey"
            columns: ["action_draft_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_action_drafts"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_decisions_item_company_fkey"
            columns: ["workflow_item_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_items"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_decisions_run_company_fkey"
            columns: ["workflow_run_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_decisions_workflow_item_id_fkey"
            columns: ["workflow_item_id"]
            isOneToOne: false
            referencedRelation: "workflow_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_decisions_workflow_run_id_fkey"
            columns: ["workflow_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_events: {
        Row: {
          company_id: string
          created_at: string
          event_key: string
          event_type: string
          freshness_state: string
          id: string
          origin: string
          payload: Json
          source_ref: Json
          validation_result: Json
          validation_status: string
          workflow_id: string
          workflow_run_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          event_key: string
          event_type: string
          freshness_state: string
          id?: string
          origin: string
          payload?: Json
          source_ref?: Json
          validation_result?: Json
          validation_status: string
          workflow_id: string
          workflow_run_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          event_key?: string
          event_type?: string
          freshness_state?: string
          id?: string
          origin?: string
          payload?: Json
          source_ref?: Json
          validation_result?: Json
          validation_status?: string
          workflow_id?: string
          workflow_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_events_run_company_fkey"
            columns: ["workflow_run_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_events_workflow_company_fkey"
            columns: ["workflow_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_workflows"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_events_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "agent_workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_events_workflow_run_id_fkey"
            columns: ["workflow_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_evidence_snapshots: {
        Row: {
          assumptions: Json
          company_id: string
          created_at: string
          evidence: Json
          id: string
          recommendation_run_id: string
          source_refs: Json
          warnings: Json
          workflow_item_id: string
          workflow_run_id: string
        }
        Insert: {
          assumptions?: Json
          company_id: string
          created_at?: string
          evidence?: Json
          id?: string
          recommendation_run_id: string
          source_refs?: Json
          warnings?: Json
          workflow_item_id: string
          workflow_run_id: string
        }
        Update: {
          assumptions?: Json
          company_id?: string
          created_at?: string
          evidence?: Json
          id?: string
          recommendation_run_id?: string
          source_refs?: Json
          warnings?: Json
          workflow_item_id?: string
          workflow_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_evidence_snapshots_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_evidence_snapshots_item_company_fkey"
            columns: ["workflow_item_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_items"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_evidence_snapshots_recommendation_company_fkey"
            columns: ["recommendation_run_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_recommendation_runs"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_evidence_snapshots_recommendation_run_id_fkey"
            columns: ["recommendation_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_recommendation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_evidence_snapshots_run_company_fkey"
            columns: ["workflow_run_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_evidence_snapshots_workflow_item_id_fkey"
            columns: ["workflow_item_id"]
            isOneToOne: false
            referencedRelation: "workflow_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_evidence_snapshots_workflow_run_id_fkey"
            columns: ["workflow_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_execution_tokens: {
        Row: {
          action_draft_id: string
          action_type: string
          company_id: string
          consumed_at: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          payload_hash: string
          revoked_at: string | null
          revoked_by: string | null
          token_hash: string
        }
        Insert: {
          action_draft_id: string
          action_type: string
          company_id: string
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          payload_hash: string
          revoked_at?: string | null
          revoked_by?: string | null
          token_hash: string
        }
        Update: {
          action_draft_id?: string
          action_type?: string
          company_id?: string
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          payload_hash?: string
          revoked_at?: string | null
          revoked_by?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_execution_tokens_action_draft_id_fkey"
            columns: ["action_draft_id"]
            isOneToOne: false
            referencedRelation: "workflow_action_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_execution_tokens_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_execution_tokens_draft_company_fkey"
            columns: ["action_draft_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_action_drafts"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      workflow_fixture_adapters: {
        Row: {
          adapter_key: string
          allowed_action_types: string[]
          allowed_audit_event_types: string[]
          allowed_event_types: string[]
          allowed_item_types: string[]
          allowed_node_kinds: string[]
          allowed_scenario_ids: string[]
          allowed_tools: string[]
          allowed_trigger_kinds: string[]
          canonical_edit_policy: Json
          created_at: string
          version: string
          workflow_key: string
          workflow_type: string
        }
        Insert: {
          adapter_key: string
          allowed_action_types: string[]
          allowed_audit_event_types: string[]
          allowed_event_types: string[]
          allowed_item_types: string[]
          allowed_node_kinds: string[]
          allowed_scenario_ids: string[]
          allowed_tools: string[]
          allowed_trigger_kinds: string[]
          canonical_edit_policy: Json
          created_at?: string
          version: string
          workflow_key: string
          workflow_type: string
        }
        Update: {
          adapter_key?: string
          allowed_action_types?: string[]
          allowed_audit_event_types?: string[]
          allowed_event_types?: string[]
          allowed_item_types?: string[]
          allowed_node_kinds?: string[]
          allowed_scenario_ids?: string[]
          allowed_tools?: string[]
          allowed_trigger_kinds?: string[]
          canonical_edit_policy?: Json
          created_at?: string
          version?: string
          workflow_key?: string
          workflow_type?: string
        }
        Relationships: []
      }
      workflow_items: {
        Row: {
          assignee_id: string | null
          company_id: string
          created_at: string
          due_at: string | null
          id: string
          item_key: string
          item_type: string
          owner_role: string | null
          priority: number
          queue_search_document: unknown
          related_records: Json
          resolution_state: Json
          source_type: string | null
          status: string
          title: string
          updated_at: string
          workflow_event_id: string
          workflow_id: string
          workflow_run_id: string
        }
        Insert: {
          assignee_id?: string | null
          company_id: string
          created_at?: string
          due_at?: string | null
          id?: string
          item_key: string
          item_type: string
          owner_role?: string | null
          priority?: number
          queue_search_document?: unknown
          related_records?: Json
          resolution_state?: Json
          source_type?: string | null
          status: string
          title: string
          updated_at?: string
          workflow_event_id: string
          workflow_id: string
          workflow_run_id: string
        }
        Update: {
          assignee_id?: string | null
          company_id?: string
          created_at?: string
          due_at?: string | null
          id?: string
          item_key?: string
          item_type?: string
          owner_role?: string | null
          priority?: number
          queue_search_document?: unknown
          related_records?: Json
          resolution_state?: Json
          source_type?: string | null
          status?: string
          title?: string
          updated_at?: string
          workflow_event_id?: string
          workflow_id?: string
          workflow_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_items_assignee_company_fkey"
            columns: ["company_id", "assignee_id"]
            isOneToOne: false
            referencedRelation: "company_memberships"
            referencedColumns: ["company_id", "user_id"]
          },
          {
            foreignKeyName: "workflow_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_items_event_company_fkey"
            columns: ["workflow_event_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_events"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_items_run_company_fkey"
            columns: ["workflow_run_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_items_workflow_company_fkey"
            columns: ["workflow_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_workflows"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_items_workflow_event_id_fkey"
            columns: ["workflow_event_id"]
            isOneToOne: false
            referencedRelation: "workflow_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_items_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "agent_workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_items_workflow_run_id_fkey"
            columns: ["workflow_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_recommendation_runs: {
        Row: {
          company_id: string
          confidence: number | null
          context_packet_id: string
          created_at: string
          freshness_state: string
          id: string
          input: Json
          langsmith_run_id: string | null
          langsmith_trace_id: string | null
          output: Json
          rationale_summary: string
          status: string
          warning_state: string
          warnings: Json
          workflow_item_id: string
          workflow_run_id: string
        }
        Insert: {
          company_id: string
          confidence?: number | null
          context_packet_id: string
          created_at?: string
          freshness_state: string
          id?: string
          input?: Json
          langsmith_run_id?: string | null
          langsmith_trace_id?: string | null
          output?: Json
          rationale_summary: string
          status: string
          warning_state: string
          warnings?: Json
          workflow_item_id: string
          workflow_run_id: string
        }
        Update: {
          company_id?: string
          confidence?: number | null
          context_packet_id?: string
          created_at?: string
          freshness_state?: string
          id?: string
          input?: Json
          langsmith_run_id?: string | null
          langsmith_trace_id?: string | null
          output?: Json
          rationale_summary?: string
          status?: string
          warning_state?: string
          warnings?: Json
          workflow_item_id?: string
          workflow_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_recommendation_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_recommendation_runs_context_company_fkey"
            columns: ["context_packet_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_context_packets"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_recommendation_runs_context_packet_id_fkey"
            columns: ["context_packet_id"]
            isOneToOne: false
            referencedRelation: "workflow_context_packets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_recommendation_runs_item_company_fkey"
            columns: ["workflow_item_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_items"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_recommendation_runs_run_company_fkey"
            columns: ["workflow_run_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_recommendation_runs_workflow_item_id_fkey"
            columns: ["workflow_item_id"]
            isOneToOne: false
            referencedRelation: "workflow_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_recommendation_runs_workflow_run_id_fkey"
            columns: ["workflow_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_resume_outbox: {
        Row: {
          attempts: number
          available_at: string
          binding_snapshot_id: string | null
          checkpoint: Json
          company_id: string
          completed_at: string | null
          created_at: string
          dedupe_key: string
          event_type: string
          id: string
          leased_until: string | null
          node_key: string
          payload: Json
          status: string
          updated_at: string
          workflow_run_id: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          binding_snapshot_id?: string | null
          checkpoint?: Json
          company_id: string
          completed_at?: string | null
          created_at?: string
          dedupe_key: string
          event_type: string
          id?: string
          leased_until?: string | null
          node_key: string
          payload?: Json
          status?: string
          updated_at?: string
          workflow_run_id: string
        }
        Update: {
          attempts?: number
          available_at?: string
          binding_snapshot_id?: string | null
          checkpoint?: Json
          company_id?: string
          completed_at?: string | null
          created_at?: string
          dedupe_key?: string
          event_type?: string
          id?: string
          leased_until?: string | null
          node_key?: string
          payload?: Json
          status?: string
          updated_at?: string
          workflow_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_resume_outbox_binding_snapshot_id_company_id_fkey"
            columns: ["binding_snapshot_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_binding_snapshots"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_resume_outbox_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_resume_outbox_workflow_run_id_company_id_fkey"
            columns: ["workflow_run_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      workflow_runs: {
        Row: {
          company_id: string
          completed_at: string | null
          error_message: string | null
          id: string
          input: Json
          langgraph_checkpoint_id: string | null
          langgraph_thread_id: string | null
          langsmith_run_id: string | null
          langsmith_trace_id: string | null
          started_at: string
          started_by: string | null
          status: string
          workflow_binding_snapshot_id: string | null
          workflow_id: string
          workflow_type: string
        }
        Insert: {
          company_id: string
          completed_at?: string | null
          error_message?: string | null
          id?: string
          input?: Json
          langgraph_checkpoint_id?: string | null
          langgraph_thread_id?: string | null
          langsmith_run_id?: string | null
          langsmith_trace_id?: string | null
          started_at?: string
          started_by?: string | null
          status: string
          workflow_binding_snapshot_id?: string | null
          workflow_id: string
          workflow_type: string
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          error_message?: string | null
          id?: string
          input?: Json
          langgraph_checkpoint_id?: string | null
          langgraph_thread_id?: string | null
          langsmith_run_id?: string | null
          langsmith_trace_id?: string | null
          started_at?: string
          started_by?: string | null
          status?: string
          workflow_binding_snapshot_id?: string | null
          workflow_id?: string
          workflow_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_runs_binding_snapshot_company_fkey"
            columns: ["workflow_binding_snapshot_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_binding_snapshots"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_runs_workflow_company_fkey"
            columns: ["workflow_id", "company_id"]
            isOneToOne: false
            referencedRelation: "agent_workflows"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_runs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "agent_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_workspace_mapping_bindings: {
        Row: {
          binding_snapshot_id: string
          catalog_digest: string
          company_id: string
          created_at: string
          freshness_snapshot: Json
          mapping_spec_hash: string
          mapping_version_id: string
          policy_snapshot: Json
          requirement_key: string
        }
        Insert: {
          binding_snapshot_id: string
          catalog_digest: string
          company_id: string
          created_at?: string
          freshness_snapshot: Json
          mapping_spec_hash: string
          mapping_version_id: string
          policy_snapshot: Json
          requirement_key: string
        }
        Update: {
          binding_snapshot_id?: string
          catalog_digest?: string
          company_id?: string
          created_at?: string
          freshness_snapshot?: Json
          mapping_spec_hash?: string
          mapping_version_id?: string
          policy_snapshot?: Json
          requirement_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_workspace_mapping_bi_binding_snapshot_id_company__fkey"
            columns: ["binding_snapshot_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workflow_binding_snapshots"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_workspace_mapping_bi_mapping_version_id_company_i_fkey"
            columns: ["mapping_version_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workspace_capability_mapping_versions"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workflow_workspace_mapping_bindings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_capability_mapping_datasets: {
        Row: {
          company_id: string
          created_at: string
          dataset_alias: string
          expected_schema_hash: string | null
          mapping_version_id: string
          maximum_freshness_hours: number
          record_type: string
          required: boolean
          source_key: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          dataset_alias: string
          expected_schema_hash?: string | null
          mapping_version_id: string
          maximum_freshness_hours?: number
          record_type: string
          required?: boolean
          source_key?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          dataset_alias?: string
          expected_schema_hash?: string | null
          mapping_version_id?: string
          maximum_freshness_hours?: number
          record_type?: string
          required?: boolean
          source_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workspace_capability_mapping__mapping_version_id_company_i_fkey"
            columns: ["mapping_version_id", "company_id"]
            isOneToOne: false
            referencedRelation: "workspace_capability_mapping_versions"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "workspace_capability_mapping_datasets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_capability_mapping_versions: {
        Row: {
          capability_version_id: string
          company_id: string
          confidence: number
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string
          id: string
          mapping_key: string
          provenance: Json
          spec: Json
          spec_hash: string
          status: string
          version: number
        }
        Insert: {
          capability_version_id: string
          company_id: string
          confidence: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by: string
          id?: string
          mapping_key: string
          provenance?: Json
          spec: Json
          spec_hash: string
          status: string
          version: number
        }
        Update: {
          capability_version_id?: string
          company_id?: string
          confidence?: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string
          id?: string
          mapping_key?: string
          provenance?: Json
          spec?: Json
          spec_hash?: string
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "workspace_capability_mapping_version_capability_version_id_fkey"
            columns: ["capability_version_id"]
            isOneToOne: false
            referencedRelation: "capability_definition_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_capability_mapping_versions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_data_catalogs: {
        Row: {
          catalog_version: number
          company_id: string
          created_at: string
          field_profile: Json
          first_observed_at: string | null
          freshest_observed_at: string | null
          id: string
          profile_status: string
          profiled_at: string | null
          record_count: number
          record_type: string
          relationship_profile: Json
          schema_hash: string | null
          source_id: string
          source_key: string
          updated_at: string
        }
        Insert: {
          catalog_version?: number
          company_id: string
          created_at?: string
          field_profile?: Json
          first_observed_at?: string | null
          freshest_observed_at?: string | null
          id?: string
          profile_status?: string
          profiled_at?: string | null
          record_count?: number
          record_type: string
          relationship_profile?: Json
          schema_hash?: string | null
          source_id: string
          source_key: string
          updated_at?: string
        }
        Update: {
          catalog_version?: number
          company_id?: string
          created_at?: string
          field_profile?: Json
          first_observed_at?: string | null
          freshest_observed_at?: string | null
          id?: string
          profile_status?: string
          profiled_at?: string | null
          record_count?: number
          record_type?: string
          relationship_profile?: Json
          schema_hash?: string | null
          source_id?: string
          source_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_data_catalogs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_data_catalogs_source_id_company_id_fkey"
            columns: ["source_id", "company_id"]
            isOneToOne: false
            referencedRelation: "external_sources"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
    }
    Views: {
      email_delivery_owner_status: {
        Row: {
          attempt_count: number | null
          company_id: string | null
          created_at: string | null
          id: string | null
          owner_status: string | null
          state: string | null
          template_key: string | null
          template_version: string | null
          updated_at: string | null
        }
        Insert: {
          attempt_count?: number | null
          company_id?: string | null
          created_at?: string | null
          id?: string | null
          owner_status?: never
          state?: string | null
          template_key?: string | null
          template_version?: string | null
          updated_at?: string | null
        }
        Update: {
          attempt_count?: number | null
          company_id?: string | null
          created_at?: string | null
          id?: string | null
          owner_status?: never
          state?: string | null
          template_key?: string | null
          template_version?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_deliveries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_control_request_audit: {
        Row: {
          actor_id: string | null
          client_surface: string | null
          company_id: string | null
          created_at: string | null
          id: string | null
          langsmith_run_id: string | null
          langsmith_trace_id: string | null
          normalized_intent: Json | null
          parser_kind: string | null
          resolution_status: string | null
          risk_class: string | null
          updated_at: string | null
          workflow_item_id: string | null
          workflow_run_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_company_invitation: {
        Args: { p_token_digest: string }
        Returns: Json
      }
      accept_context_index_work_v1: {
        Args: {
          p_lease_id: string
          p_now?: string
          p_provider_document_id: string
          p_worker_id: string
        }
        Returns: Json
      }
      acquire_workflow_control_parser_lease: {
        Args: { p_company_id: string }
        Returns: Json
      }
      activate_agent_workflow: {
        Args: {
          p_binding_snapshot_id: string
          p_company_id: string
          p_expected_current_workflow_id?: string
          p_workflow_id: string
        }
        Returns: Json
      }
      begin_registered_agent_execution_v1: {
        Args: {
          p_action_draft_id: string
          p_company_id: string
          p_decision_id: string
          p_idempotency_key: string
          p_mode: string
          p_raw_token: string
          p_request_hash: string
        }
        Returns: Json
      }
      bind_workspace_mappings_v1: {
        Args: {
          p_binding_snapshot_id: string
          p_company_id: string
          p_mappings: Json
        }
        Returns: Json
      }
      bootstrap_company_owner: {
        Args: { p_company_id: string; p_owner_user_id: string }
        Returns: boolean
      }
      claim_cli_device_authorization_v1: {
        Args: { p_device_code_hash: string }
        Returns: Json
      }
      claim_context_index_cleanup_v1: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_now?: string
          p_worker_id: string
        }
        Returns: Json
      }
      claim_context_index_add_batch_v1: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_now?: string
          p_worker_id: string
        }
        Returns: Json
      }
      claim_context_index_processing_v1: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_now?: string
          p_worker_id: string
        }
        Returns: Json
      }
      claim_context_index_work_v1: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_now?: string
          p_worker_id: string
        }
        Returns: Json
      }
      claim_due_email_deliveries: {
        Args: { p_lease_seconds?: number; p_limit?: number }
        Returns: {
          attempt_number: number
          claim_token: string
          company_id: string
          delivery_id: string
          idempotency_key: string
          payload_reference: string
          recipient_email: string
          template_key: string
          template_version: string
        }[]
      }
      company_role_rank: { Args: { role: string }; Returns: number }
      complete_cli_device_authorization_v1: {
        Args: {
          p_access_expires_at: string
          p_access_token_hash: string
          p_actor_auth_session_id: string
          p_actor_session_ciphertext: string
          p_authorization_id: string
          p_exchange_nonce: string
          p_refresh_expires_at: string
          p_refresh_token_hash: string
        }
        Returns: Json
      }
      complete_context_index_work_v1: {
        Args: {
          p_lease_id: string
          p_now?: string
          p_result: Json
          p_worker_id: string
        }
        Returns: Json
      }
      complete_registered_agent_execution_v1: {
        Args: {
          p_company_id: string
          p_execution_id: string
          p_idempotency_key: string
          p_request_hash: string
          p_result: Json
        }
        Returns: Json
      }
      configure_company_connector_installation: {
        Args: {
          p_company_id: string
          p_connector_version_id: string
          p_display_name: string
        }
        Returns: Json
      }
      configure_context_index_operations_v1: {
        Args: {
          p_canary_record_limit: number
          p_company_id: string
          p_daily_cost_cap_microunits: number
          p_daily_operation_cap: number
          p_now?: string
          p_readiness: string
          p_reason: string
          p_requests_per_minute: number
          p_worker_enabled: boolean
        }
        Returns: Json
      }
      configure_workflow_control_parser_trust: {
        Args: { p_server_secret: string }
        Returns: undefined
      }
      create_agent_memory_candidate_v1: {
        Args: { p_actor_id: string; p_company_id: string; p_payload: Json }
        Returns: Json
      }
      create_cli_device_authorization_v1: {
        Args: {
          p_browser_token_hash: string
          p_client_name: string
          p_client_platform: string
          p_client_version: string
          p_device_code_hash: string
          p_expires_at?: string
          p_id: string
          p_requested_scopes?: string[]
          p_requester_hash: string
        }
        Returns: Json
      }
      create_company_with_owner: { Args: { p_name: string }; Returns: Json }
      create_workflow_binding_snapshot: {
        Args: { p_bindings: Json; p_company_id: string; p_workflow_id: string }
        Returns: Json
      }
      deactivate_agent_workflow: {
        Args: {
          p_company_id: string
          p_expected_current_workflow_id: string
          p_workflow_key: string
        }
        Returns: Json
      }
      decide_cli_device_authorization_v1: {
        Args: {
          p_actor_user_id: string
          p_browser_token_hash: string
          p_company_id: string | null
          p_decision: string
          p_subject_hash: string
        }
        Returns: Json
      }
      defer_context_index_processing_v1: {
        Args: {
          p_lease_id: string
          p_now?: string
          p_processing_status: string
          p_worker_id: string
        }
        Returns: Json
      }
      disable_own_company_membership: {
        Args: { p_company_id: string }
        Returns: boolean
      }
      enqueue_email_delivery: {
        Args: {
          p_company_id: string
          p_due_at?: string
          p_idempotency_key: string
          p_payload_reference: string
          p_recipient_email: string
          p_template_key: string
          p_template_version: string
        }
        Returns: {
          attempt_count: number
          claim_expires_at: string | null
          claim_token: string | null
          company_id: string
          created_at: string
          id: string
          idempotency_key: string
          last_error_category: string | null
          next_attempt_at: string
          payload_reference: string
          provider_email_id: string | null
          provider_event_at: string | null
          recipient_email: string
          recipient_hash: string
          state: string
          template_key: string
          template_version: string
          terminal_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "email_deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      execute_mock_workflow_action: {
        Args: {
          p_action_draft_id: string
          p_company_id: string
          p_decision_id: string
          p_idempotency_key: string
          p_payload: Json
          p_raw_token: string
        }
        Returns: Json
      }
      execute_mock_workflow_action_controlled: {
        Args: {
          p_action_draft_id: string
          p_client_surface: string
          p_company_id: string
          p_decision_id: string
          p_idempotency_key: string
          p_input_hash: string
          p_payload: Json
          p_raw_token: string
        }
        Returns: Json
      }
      execute_mock_workflow_action_controlled_reusing_request: {
        Args: {
          p_action_draft_id: string
          p_client_surface: string
          p_company_id: string
          p_control_request_id: string
          p_decision_id: string
          p_idempotency_key: string
          p_input_hash: string
          p_payload: Json
          p_raw_token: string
        }
        Returns: Json
      }
      export_agent_memory_v1: { Args: { p_company_id: string }; Returns: Json }
      fail_context_index_work_v1: {
        Args: {
          p_disposition: string
          p_error_code: string
          p_lease_id: string
          p_now?: string
          p_worker_id: string
        }
        Returns: Json
      }
      forget_agent_memory_candidate_v1: {
        Args: {
          p_actor_id: string
          p_candidate_id: string
          p_company_id: string
          p_expected_updated_at: string
          p_reason: string
        }
        Returns: Json
      }
      get_agent_runtime_state_v1: {
        Args: { p_company_id: string; p_workflow_id: string }
        Returns: Json
      }
      get_company_identity: { Args: { p_company_id: string }; Returns: Json }
      get_company_invitation_resend_version: {
        Args: { p_invitation_id: string }
        Returns: number
      }
      get_company_usage_summary_v1: {
        Args: {
          p_company_id: string
          p_period_end: string
          p_period_start: string
        }
        Returns: Json
      }
      get_context_index_status_legacy_v1: {
        Args: { p_company_id: string }
        Returns: Json
      }
      get_context_index_status_v1: {
        Args: { p_company_id: string }
        Returns: Json
      }
      get_context_retrieval_ledger_v1: {
        Args: {
          p_canonical_record_ids: string[]
          p_company_id: string
        }
        Returns: {
          canonical_record_id: string
          canonical_version: string
          content_hash: string
          policy_hash: string
          policy_version: number
          provider_document_id: string
          record_type: string
          source_key: string
          stable_custom_id: string
          status: string
        }[]
      }
      get_my_profile_identity: { Args: never; Returns: Json }
      get_registered_agent_execution_context_v1: {
        Args: {
          p_action_draft_id: string
          p_company_id: string
          p_decision_id: string
        }
        Returns: Json
      }
      get_sandbox_workspace_snapshot_v1: {
        Args: { p_candidate_limit?: number; p_company_id: string }
        Returns: Json
      }
      get_workflow_context_provenance_v1: {
        Args: { p_company_id: string; p_context_packet_id: string }
        Returns: Json
      }
      get_workflow_review_v1: {
        Args: {
          p_activity_before_created_at?: string
          p_activity_before_id?: string
          p_activity_limit?: number
          p_company_id: string
          p_workflow_item_id: string
        }
        Returns: Json
      }
      has_company_role: {
        Args: { minimum_role: string; target_company_id: string }
        Returns: boolean
      }
      inspect_cli_device_authorization_v1: {
        Args: {
          p_actor_user_id: string
          p_browser_token_hash: string
          p_subject_hash: string
        }
        Returns: Json
      }
      inspect_cli_session_refresh_v1: {
        Args: { p_refresh_token_hash: string }
        Returns: Json
      }
      inspect_company_invitation: {
        Args: { p_token_digest: string }
        Returns: Json
      }
      install_agent_workflow_version: {
        Args: {
          p_company_id: string
          p_compile_result: Json
          p_manifest: Json
          p_skill_markdown: string
        }
        Returns: Json
      }
      issue_company_invitation: {
        Args: {
          p_company_id: string
          p_expires_at: string
          p_invitation_id: string
          p_recipient_email: string
          p_token_digest: string
        }
        Returns: Json
      }
      list_company_directory: { Args: { p_company_id: string }; Returns: Json }
      list_workflow_activity_v1: {
        Args: {
          p_before_created_at?: string
          p_before_id?: string
          p_company_id: string
          p_limit?: number
          p_workflow_item_id: string
        }
        Returns: Json
      }
      list_workflow_control_request_audit: {
        Args: never
        Returns: {
          actor_id: string
          client_surface: string
          company_id: string
          created_at: string
          id: string
          langsmith_run_id: string
          langsmith_trace_id: string
          normalized_intent: Json
          parser_kind: string
          resolution_status: string
          risk_class: string
          updated_at: string
          workflow_item_id: string
          workflow_run_id: string
        }[]
      }
      list_workflow_queue_v1: {
        Args: { p_company_id: string; p_query?: Json }
        Returns: Json
      }
      persist_compiled_workflow_review_controlled: {
        Args: {
          p_binding_snapshot_id: string
          p_client_surface: string
          p_company_id: string
          p_input_hash: string
          p_payload: Json
          p_workflow_id: string
        }
        Returns: Json
      }
      persist_workflow_fixture_run: { Args: { p_payload: Json }; Returns: Json }
      persist_workflow_fixture_run_controlled: {
        Args: {
          p_client_surface: string
          p_input_hash: string
          p_payload: Json
        }
        Returns: Json
      }
      persist_workflow_fixture_run_controlled_reusing_request: {
        Args: {
          p_client_surface: string
          p_control_request_id: string
          p_input_hash: string
          p_payload: Json
        }
        Returns: Json
      }
      preflight_account_deletion: { Args: never; Returns: Json }
      prepare_context_index_work_legacy_v1: {
        Args: { p_limit?: number; p_now?: string }
        Returns: Json
      }
      prepare_context_index_work_v1: {
        Args: { p_limit?: number; p_now?: string }
        Returns: Json
      }
      publish_context_indexing_policy_v1: {
        Args: {
          p_approved_field_paths: string[]
          p_classification: string
          p_company_id: string
          p_expected_current_version: number
          p_indexing_enabled: boolean
          p_maximum_content_bytes: number
          p_projection_version: number
          p_reason: string
          p_record_type: string
          p_retention_days: number
          p_source_key: string
        }
        Returns: Json
      }
      publish_provider_model_rate_v1: {
        Args: {
          p_created_by?: string
          p_currency: string
          p_effective_from: string
          p_metric_name: string
          p_model: string
          p_price_per_unit: number
          p_provider: string
          p_quantity_per_unit: number
          p_rate_version: string
          p_source_reference: string
        }
        Returns: string
      }
      publish_workspace_capability_mapping_v1: {
        Args: {
          p_capability_version_id: string
          p_company_id: string
          p_confidence: number
          p_confirmed?: boolean
          p_mapping_key: string
          p_provenance?: Json
          p_spec: Json
        }
        Returns: Json
      }
      purge_company_invitation_pii: {
        Args: { p_before?: string }
        Returns: number
      }
      purge_terminal_email_delivery_pii: {
        Args: { p_before?: string }
        Returns: number
      }
      reconcile_context_index_work_v1: {
        Args: {
          p_company_id: string
          p_mode?: string
          p_now?: string
          p_requested_limit?: number
        }
        Returns: Json
      }
      record_account_deletion_progress: {
        Args: { p_error_code?: string; p_status: string; p_user_id: string }
        Returns: boolean
      }
      record_agent_feedback_v1: {
        Args: { p_actor_id: string; p_company_id: string; p_payload: Json }
        Returns: Json
      }
      record_agent_readiness_v1: {
        Args: {
          p_company_id: string
          p_expected_version: number
          p_issues?: Json
          p_readiness_hash: string
          p_reason?: string
          p_sample_run_id?: string
          p_workflow_id: string
        }
        Returns: Json
      }
      record_agent_test_evaluation_v1: {
        Args: {
          p_client_issues?: Json
          p_company_id: string
          p_evaluator_version?: string
          p_expected_version: number
          p_reason?: string
          p_sample_item_id: string
          p_sample_run_id: string
          p_workflow_id: string
        }
        Returns: Json
      }
      record_context_provider_health_v1: {
        Args: { p_detail_code: string; p_now?: string; p_status: string }
        Returns: Json
      }
      record_email_delivery_result: {
        Args: {
          p_claim_token: string
          p_delivery_id: string
          p_error_category?: string
          p_finished_at?: string
          p_outcome: string
          p_provider_email_id?: string
        }
        Returns: {
          attempt_count: number
          claim_expires_at: string | null
          claim_token: string | null
          company_id: string
          created_at: string
          id: string
          idempotency_key: string
          last_error_category: string | null
          next_attempt_at: string
          payload_reference: string
          provider_email_id: string | null
          provider_event_at: string | null
          recipient_email: string
          recipient_hash: string
          state: string
          template_key: string
          template_version: string
          terminal_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "email_deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_email_delivery_webhook_event: {
        Args: {
          p_event_type: string
          p_occurred_at: string
          p_provider_email_id: string
          p_provider_event_id: string
          p_safe_reason?: string
        }
        Returns: Json
      }
      record_provider_usage_v1: {
        Args: {
          p_company_id: string
          p_completeness: string
          p_idempotency_key: string
          p_measured_at: string
          p_metrics: Json
          p_model: string
          p_provider: string
          p_recorded_by: string
          p_run_id?: string
          p_source_operation: string
          p_trace_id?: string
          p_workflow_run_id?: string
        }
        Returns: Json
      }
      record_workflow_control_request: {
        Args: {
          p_client_surface: string
          p_company_id: string
          p_input_hash: string
          p_langsmith_run_id?: string
          p_langsmith_trace_id?: string
          p_normalized_intent: Json
          p_parser_kind: string
          p_resolution_status: string
          p_risk_class: string
          p_workflow_item_id?: string
          p_workflow_run_id?: string
        }
        Returns: Json
      }
      record_workflow_control_request_with_binding: {
        Args: {
          p_binding_intent: Json
          p_client_surface: string
          p_company_id: string
          p_input_hash: string
          p_langsmith_run_id?: string
          p_langsmith_trace_id?: string
          p_normalized_intent: Json
          p_parser_kind: string
          p_resolution_status: string
          p_risk_class: string
          p_server_token: string
          p_workflow_item_id?: string
          p_workflow_run_id?: string
        }
        Returns: Json
      }
      record_workflow_decision: {
        Args: {
          p_action_draft_id: string
          p_company_id: string
          p_decision: string
          p_edited_payload?: Json
          p_reason?: string
          p_warnings_acknowledged?: boolean
        }
        Returns: Json
      }
      record_workflow_decision_controlled: {
        Args: {
          p_action_draft_id: string
          p_client_surface: string
          p_company_id: string
          p_decision: string
          p_edited_payload?: Json
          p_input_hash: string
          p_reason?: string
          p_warnings_acknowledged?: boolean
        }
        Returns: Json
      }
      record_workflow_decision_controlled_reusing_request: {
        Args: {
          p_action_draft_id: string
          p_client_surface: string
          p_company_id: string
          p_control_request_id: string
          p_decision: string
          p_edited_payload?: Json
          p_input_hash: string
          p_reason?: string
          p_warnings_acknowledged?: boolean
        }
        Returns: Json
      }
      record_workflow_decision_v2: {
        Args: {
          p_action_draft_id?: string
          p_company_id: string
          p_decision: string
          p_edited_payload?: Json
          p_expected_version: string
          p_idempotency_key: string
          p_reason?: string
          p_warnings_acknowledged?: boolean
          p_workflow_item_id: string
        }
        Returns: Json
      }
      record_workflow_execution_failure: {
        Args: {
          p_action_draft_id: string
          p_company_id: string
          p_error_code: string
          p_idempotency_key: string
        }
        Returns: boolean
      }
      refresh_workspace_data_catalog_v1: {
        Args: { p_company_id: string }
        Returns: Json
      }
      reissue_workflow_execution_token: {
        Args: { p_action_draft_id: string; p_company_id: string }
        Returns: Json
      }
      release_cli_device_authorization_v1: {
        Args: { p_authorization_id: string; p_exchange_nonce: string }
        Returns: undefined
      }
      release_workflow_control_parser_lease: {
        Args: { p_company_id: string; p_lease_id: string }
        Returns: undefined
      }
      resend_company_invitation: {
        Args: {
          p_expected_version: number
          p_expires_at: string
          p_invitation_id: string
          p_token_digest: string
        }
        Returns: Json
      }
      reserve_context_provider_health_v1: {
        Args: { p_now?: string }
        Returns: Json
      }
      retrieve_agent_memory_v1: {
        Args: {
          p_as_of: string
          p_company_id: string
          p_limit: number
          p_scope: Json
        }
        Returns: Json
      }
      review_agent_memory_candidate_v1: {
        Args: {
          p_actor_id: string
          p_candidate_id: string
          p_company_id: string
          p_decision: string
          p_expected_updated_at: string
          p_expires_at: string
          p_reason: string
        }
        Returns: Json
      }
      revoke_account_memberships_for_deletion: {
        Args: { p_user_id: string }
        Returns: number
      }
      revoke_all_cli_sessions_v1: {
        Args: { p_actor_user_id: string }
        Returns: Json
      }
      revoke_cli_session_v1: {
        Args: { p_actor_user_id: string; p_cli_session_id: string }
        Returns: Json
      }
      revoke_company_invitation: {
        Args: { p_invitation_id: string }
        Returns: Json
      }
      rollback_agent_workflow:
        | {
            Args: {
              p_binding_snapshot_id: string
              p_company_id: string
              p_expected_current_workflow_id: string
              p_workflow_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_binding_snapshot_id: string
              p_company_id: string
              p_expected_current_workflow_id: string
              p_expected_state_version: number
              p_reason: string
              p_workflow_id: string
            }
            Returns: Json
          }
      rotate_cli_session_credentials_v1: {
        Args: {
          p_access_expires_at: string
          p_actor_auth_session_id: string
          p_actor_session_ciphertext: string
          p_next_access_token_hash: string
          p_next_refresh_token_hash: string
          p_refresh_expires_at: string
          p_refresh_token_hash: string
        }
        Returns: Json
      }
      schedule_agent_follow_up_v1: {
        Args: { p_actor_id: string; p_company_id: string; p_payload: Json }
        Returns: Json
      }
      set_company_approval_policy_controlled: {
        Args: {
          p_action_type: string
          p_company_id: string
          p_minimum_role?: string
          p_require_human_approval?: boolean
          p_require_warning_acknowledgement?: boolean
          p_workflow_type: string
        }
        Returns: Json
      }
      set_company_capability_policy: {
        Args: {
          p_allow_model_processing?: boolean
          p_capability_version_id: string
          p_company_id: string
          p_enabled: boolean
          p_max_bytes?: number
          p_max_rows?: number
          p_minimum_role?: string
          p_require_human_approval?: boolean
        }
        Returns: Json
      }
      set_company_connector_capability_grant: {
        Args: {
          p_capability_version_id: string
          p_company_id: string
          p_installation_id: string
          p_status: string
        }
        Returns: Json
      }
      set_company_connector_health: {
        Args: {
          p_company_id: string
          p_details?: Json
          p_installation_id: string
          p_observed_schema_hash?: string
          p_status: string
        }
        Returns: Json
      }
      set_context_workspace_configuration_v1: {
        Args: {
          p_company_id: string
          p_expected_configuration_version: number
          p_provider: string
          p_readiness: string
          p_reason: string
          p_sandbox_enabled: boolean
        }
        Returns: Json
      }
      transition_agent_lifecycle_v1: {
        Args: {
          p_company_id: string
          p_expected_version: number
          p_reason: string
          p_transition: string
          p_workflow_id: string
        }
        Returns: Json
      }
      transition_company_membership: {
        Args: {
          p_action: string
          p_company_id: string
          p_requested_role?: string
          p_target_user_id: string
        }
        Returns: Json
      }
      transition_workflow_control_request: {
        Args: {
          p_company_id: string
          p_control_request_id: string
          p_resolution_status: string
          p_workflow_item_id?: string
          p_workflow_run_id?: string
        }
        Returns: Json
      }
      update_company_identity: {
        Args: {
          p_company_id: string
          p_expected_version: number
          p_logo_path: string
          p_name: string
        }
        Returns: Json
      }
      update_my_profile_identity: {
        Args: {
          p_avatar_path: string
          p_display_name: string
          p_expected_version: number
          p_first_name: string
          p_last_name: string
          p_timezone: string
        }
        Returns: Json
      }
      update_my_profile_preferences: {
        Args: {
          p_expected_version: number
          p_theme_accent: string
          p_theme_mode: string
        }
        Returns: Json
      }
      validate_cli_session_v1: {
        Args: { p_access_token_hash: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
