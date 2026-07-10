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
      agent_workflows: {
        Row: {
          company_id: string
          compile_result: Json
          created_at: string
          created_by: string | null
          id: string
          name: string
          skill_markdown: string | null
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
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          skill_markdown?: string | null
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
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          skill_markdown?: string | null
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
          created_by: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          updated_at?: string
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
          theme_accent: string
          theme_mode: string
          timezone: string
          user_id: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          display_name?: string | null
          theme_accent?: string
          theme_mode?: string
          timezone?: string
          user_id: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          display_name?: string | null
          theme_accent?: string
          theme_mode?: string
          timezone?: string
          user_id?: string
        }
        Relationships: []
      }
      workflow_action_attempts: {
        Row: {
          action_draft_id: string
          action_type: string
          company_id: string
          completed_at: string | null
          created_at: string
          decision_id: string
          error_message: string | null
          execution_token_id: string
          id: string
          idempotency_key: string
          mock_external_id: string | null
          mode: string
          request_payload: Json
          result_payload: Json
          status: string
          workflow_item_id: string
          workflow_run_id: string
        }
        Insert: {
          action_draft_id: string
          action_type: string
          company_id: string
          completed_at?: string | null
          created_at?: string
          decision_id: string
          error_message?: string | null
          execution_token_id: string
          id?: string
          idempotency_key: string
          mock_external_id?: string | null
          mode: string
          request_payload?: Json
          result_payload?: Json
          status: string
          workflow_item_id: string
          workflow_run_id: string
        }
        Update: {
          action_draft_id?: string
          action_type?: string
          company_id?: string
          completed_at?: string | null
          created_at?: string
          decision_id?: string
          error_message?: string | null
          execution_token_id?: string
          id?: string
          idempotency_key?: string
          mock_external_id?: string | null
          mode?: string
          request_payload?: Json
          result_payload?: Json
          status?: string
          workflow_item_id?: string
          workflow_run_id?: string
        }
        Relationships: [
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
      workflow_context_packets: {
        Row: {
          company_id: string
          created_at: string
          facts: Json
          freshness_state: string
          id: string
          memory_refs: Json
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
      workflow_decisions: {
        Row: {
          action_draft_id: string
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
          action_draft_id: string
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
          action_draft_id?: string
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
          company_id: string
          created_at: string
          id: string
          item_key: string
          item_type: string
          priority: number
          related_records: Json
          resolution_state: Json
          status: string
          title: string
          updated_at: string
          workflow_event_id: string
          workflow_id: string
          workflow_run_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          item_key: string
          item_type: string
          priority?: number
          related_records?: Json
          resolution_state?: Json
          status: string
          title: string
          updated_at?: string
          workflow_event_id: string
          workflow_id: string
          workflow_run_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          item_key?: string
          item_type?: string
          priority?: number
          related_records?: Json
          resolution_state?: Json
          status?: string
          title?: string
          updated_at?: string
          workflow_event_id?: string
          workflow_id?: string
          workflow_run_id?: string
        }
        Relationships: [
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
          workflow_id?: string
          workflow_type?: string
        }
        Relationships: [
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
    }
    Views: {
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
        Insert: {
          actor_id?: string | null
          client_surface?: string | null
          company_id?: string | null
          created_at?: string | null
          id?: string | null
          langsmith_run_id?: string | null
          langsmith_trace_id?: string | null
          normalized_intent?: Json | null
          parser_kind?: string | null
          resolution_status?: string | null
          risk_class?: string | null
          updated_at?: string | null
          workflow_item_id?: string | null
          workflow_run_id?: string | null
        }
        Update: {
          actor_id?: string | null
          client_surface?: string | null
          company_id?: string | null
          created_at?: string | null
          id?: string | null
          langsmith_run_id?: string | null
          langsmith_trace_id?: string | null
          normalized_intent?: Json | null
          parser_kind?: string | null
          resolution_status?: string | null
          risk_class?: string | null
          updated_at?: string | null
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
    }
    Functions: {
      acquire_workflow_control_parser_lease: {
        Args: { p_company_id: string }
        Returns: Json
      }
      company_role_rank: { Args: { role: string }; Returns: number }
      configure_workflow_control_parser_trust: {
        Args: { p_server_secret: string }
        Returns: undefined
      }
      disable_own_company_membership: {
        Args: { p_company_id: string }
        Returns: boolean
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
      has_company_role: {
        Args: { minimum_role: string; target_company_id: string }
        Returns: boolean
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
      record_workflow_execution_failure: {
        Args: {
          p_action_draft_id: string
          p_company_id: string
          p_error_code: string
          p_idempotency_key: string
        }
        Returns: boolean
      }
      reissue_workflow_execution_token: {
        Args: { p_action_draft_id: string; p_company_id: string }
        Returns: Json
      }
      release_workflow_control_parser_lease: {
        Args: { p_company_id: string; p_lease_id: string }
        Returns: undefined
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

