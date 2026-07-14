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
      configure_company_connector_installation: {
        Args: {
          p_company_id: string
          p_connector_version_id: string
          p_display_name: string
        }
        Returns: Json
      }
      configure_workflow_control_parser_trust: {
        Args: { p_server_secret: string }
        Returns: undefined
      }
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
      has_company_role: {
        Args: { minimum_role: string; target_company_id: string }
        Returns: boolean
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
      purge_terminal_email_delivery_pii: {
        Args: { p_before?: string }
        Returns: number
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
      rollback_agent_workflow: {
        Args: {
          p_binding_snapshot_id: string
          p_company_id: string
          p_expected_current_workflow_id: string
          p_workflow_id: string
        }
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

