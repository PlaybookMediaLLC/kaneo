// Generated from apps/docs/openapi.json by scripts/quills-web/sync-operation-routes.mjs.
export const quillsOperationRoutes = [
  {
    operationId: "acceptQuillsPortalInvite",
    method: "POST",
    path: "/api/quills-public/{workspace}/portal/invites/{inviteId}/accept",
  },
  {
    operationId: "acceptQuillsSuggestion",
    method: "POST",
    path: "/api/quills/{workspaceId}/suggestions/{suggestionId}/accept",
  },
  {
    operationId: "acceptQuillsWebsiteBrandingOffer",
    method: "POST",
    path: "/api/quills/{workspaceId}/settings/website-branding/accept",
  },
  {
    operationId: "addQuillsConversationNote",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/note",
  },
  {
    operationId: "addQuillsConversationParticipant",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/participants",
  },
  {
    operationId: "addQuillsConversationTag",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/tags",
  },
  {
    operationId: "addQuillsNotificationChannel",
    method: "POST",
    path: "/api/quills/{workspaceId}/integrations/{integrationId}/channels",
  },
  {
    operationId: "addQuillsPostProxyVote",
    method: "PUT",
    path: "/api/quills/{workspaceId}/posts/{postId}/voters/{principalId}",
  },
  {
    operationId: "addQuillsSegmentMembers",
    method: "POST",
    path: "/api/quills/{workspaceId}/segments/{segmentId}/members",
  },
  {
    operationId: "addQuillsStatusSubscriber",
    method: "POST",
    path: "/api/quills/{workspaceId}/status/subscribers",
  },
  {
    operationId: "addQuillsTicketNote",
    method: "POST",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/note",
  },
  {
    operationId: "addQuillsTicketWatcher",
    method: "PUT",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/watchers/{principalId}",
  },
  {
    operationId: "addQuillsWebSource",
    method: "POST",
    path: "/api/quills/{workspaceId}/assistant/web-sources",
  },
  {
    operationId: "applyQuillsMacro",
    method: "POST",
    path: "/api/quills/{workspaceId}/macros/{macroId}/apply",
  },
  {
    operationId: "approveQuillsAssistantAction",
    method: "POST",
    path: "/api/quills/{workspaceId}/assistant/pending-actions/{actionId}/approve",
  },
  {
    operationId: "approveQuillsComment",
    method: "POST",
    path: "/api/quills/{workspaceId}/moderation/comments/{commentId}/approve",
  },
  {
    operationId: "approveQuillsPost",
    method: "POST",
    path: "/api/quills/{workspaceId}/moderation/posts/{postId}/approve",
  },
  {
    operationId: "archiveQuillsConversationAttribute",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversation-attributes/{attributeId}/archive",
  },
  {
    operationId: "archiveQuillsConversationTag",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/conversation-tags/{tagId}",
  },
  {
    operationId: "archiveQuillsNotification",
    method: "POST",
    path: "/api/quills/{workspaceId}/notifications/{notificationId}/archive",
  },
  {
    operationId: "archiveQuillsReadNotifications",
    method: "POST",
    path: "/api/quills/{workspaceId}/notifications/archive-read",
  },
  {
    operationId: "archiveQuillsSlaPolicy",
    method: "POST",
    path: "/api/quills/{workspaceId}/sla-policies/{slaPolicyId}/archive",
  },
  {
    operationId: "archiveQuillsTicketType",
    method: "POST",
    path: "/api/quills/{workspaceId}/ticket-types/{ticketTypeId}/archive",
  },
  {
    operationId: "assignQuillsConversation",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/assign",
  },
  {
    operationId: "assignQuillsConversationTeam",
    method: "PUT",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/team",
  },
  {
    operationId: "assignQuillsTicket",
    method: "POST",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/assign",
  },
  {
    operationId: "assignQuillsUserTag",
    method: "PUT",
    path: "/api/quills/{workspaceId}/users/{principalId}/tags",
  },
  {
    operationId: "attributeQuillsBreakdown",
    method: "GET",
    path: "/api/quills/{workspaceId}/support/reporting/attribute-breakdown",
  },
  {
    operationId: "attributeQuillsValueCounts",
    method: "GET",
    path: "/api/quills/{workspaceId}/conversation-attributes/{attributeId}/value-counts",
  },
  {
    operationId: "bindQuillsTeam",
    method: "POST",
    path: "/api/quills/{workspaceId}/teams",
  },
  {
    operationId: "blockQuillsUser",
    method: "PUT",
    path: "/api/quills/{workspaceId}/users/{principalId}/block",
  },
  {
    operationId: "bulkQuillsDeleteConversations",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversations/bulk-delete",
  },
  {
    operationId: "bulkQuillsUpdateConversations",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversations/bulk",
  },
  {
    operationId: "bulkUpdateQuillsTickets",
    method: "POST",
    path: "/api/quills/{workspaceId}/tickets/bulk",
  },
  {
    operationId: "cancelQuillsPortalInvite",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/portal/invites/{inviteId}",
  },
  {
    operationId: "captureQuillsVisitorContactEmail",
    method: "PUT",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/contact-email",
  },
  {
    operationId: "checkQuillsS3Configured",
    method: "GET",
    path: "/api/quills/{workspaceId}/storage",
  },
  {
    operationId: "clearQuillsInboundForwarding",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/support/email-channel/inbound/forwarding",
  },
  {
    operationId: "clearQuillsStatusHistory",
    method: "POST",
    path: "/api/quills/{workspaceId}/status/history/clear",
  },
  {
    operationId: "completeQuillsConnectorOAuth",
    method: "GET",
    path: "/api/quills-public/signed/oauth/connectors/{connectorId}/callback",
  },
  {
    operationId: "completeQuillsOAuthConnect",
    method: "GET",
    path: "/api/quills-public/signed/oauth/{type}/callback",
  },
  {
    operationId: "completeQuillsOAuthFragmentConnect",
    method: "POST",
    path: "/api/quills-public/signed/oauth/{type}/callback",
  },
  {
    operationId: "confirmQuillsEmailChange",
    method: "POST",
    path: "/api/quills-public/{workspace}/widget/contact-email/confirm",
  },
  {
    operationId: "createQuillsAdminAssistantCopilot",
    method: "POST",
    path: "/api/quills/{workspaceId}/assistant/copilot",
  },
  {
    operationId: "createQuillsAdminAssistantTransform",
    method: "POST",
    path: "/api/quills/{workspaceId}/assistant/transform",
  },
  {
    operationId: "createQuillsAppPost",
    method: "POST",
    path: "/api/quills/{workspaceId}/apps/posts",
  },
  {
    operationId: "createQuillsAppRegistration",
    method: "POST",
    path: "/api/quills/{workspaceId}/app-registrations",
  },
  {
    operationId: "createQuillsBoard",
    method: "POST",
    path: "/api/quills/{workspaceId}/boards",
  },
  {
    operationId: "createQuillsChangelogCategory",
    method: "POST",
    path: "/api/quills/{workspaceId}/changelog/categories",
  },
  {
    operationId: "createQuillsChangelogEntry",
    method: "POST",
    path: "/api/quills/{workspaceId}/changelog",
  },
  {
    operationId: "createQuillsComment",
    method: "POST",
    path: "/api/quills/{workspaceId}/posts/{postId}/comments",
  },
  {
    operationId: "createQuillsCompany",
    method: "POST",
    path: "/api/quills/{workspaceId}/companies",
  },
  {
    operationId: "createQuillsCompanyAttribute",
    method: "POST",
    path: "/api/quills/{workspaceId}/company-attributes",
  },
  {
    operationId: "createQuillsConnector",
    method: "POST",
    path: "/api/quills/{workspaceId}/assistant/connectors",
  },
  {
    operationId: "createQuillsConversationAttribute",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversation-attributes",
  },
  {
    operationId: "createQuillsConversationTag",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversation-tags",
  },
  {
    operationId: "createQuillsConversationView",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversation-views",
  },
  {
    operationId: "createQuillsExportWorkspace",
    method: "POST",
    path: "/api/quills/{workspaceId}/transfer/export-runs",
  },
  {
    operationId: "createQuillsFiles",
    method: "POST",
    path: "/api/quills/{workspaceId}/files",
  },
  {
    operationId: "createQuillsFilesOpened",
    method: "POST",
    path: "/api/quills/{workspaceId}/files/{fileId}/opened",
  },
  {
    operationId: "createQuillsGuidanceRule",
    method: "POST",
    path: "/api/quills/{workspaceId}/assistant/guidance-rules",
  },
  {
    operationId: "createQuillsHelpCenterArticle",
    method: "POST",
    path: "/api/quills/{workspaceId}/help-center/articles",
  },
  {
    operationId: "createQuillsHelpCenterCategory",
    method: "POST",
    path: "/api/quills/{workspaceId}/help-center/categories",
  },
  {
    operationId: "createQuillsHelpCenterRedirectRule",
    method: "POST",
    path: "/api/quills/{workspaceId}/help-center/redirect-rules",
  },
  {
    operationId: "createQuillsImport",
    method: "POST",
    path: "/api/quills/{workspaceId}/transfer/import-runs",
  },
  {
    operationId: "createQuillsMacro",
    method: "POST",
    path: "/api/quills/{workspaceId}/macros",
  },
  {
    operationId: "createQuillsMyTicket",
    method: "POST",
    path: "/api/quills-public/{workspace}/support/tickets",
  },
  {
    operationId: "createQuillsPortalComment",
    method: "POST",
    path: "/api/quills-public/{workspace}/portal/posts/{postId}/comments",
  },
  {
    operationId: "createQuillsPortalFiles",
    method: "POST",
    path: "/api/quills-public/{workspace}/portal/files",
  },
  {
    operationId: "createQuillsPortalInviteLink",
    method: "POST",
    path: "/api/quills/{workspaceId}/portal/invites/{inviteId}/link",
  },
  {
    operationId: "createQuillsPortalPost",
    method: "POST",
    path: "/api/quills-public/{workspace}/portal/posts",
  },
  {
    operationId: "createQuillsPortalUpload",
    method: "POST",
    path: "/api/quills-public/{workspace}/portal/uploads",
  },
  {
    operationId: "createQuillsPost",
    method: "POST",
    path: "/api/quills/{workspaceId}/posts",
  },
  {
    operationId: "createQuillsPostFromConversation",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/posts",
  },
  {
    operationId: "createQuillsPostView",
    method: "POST",
    path: "/api/quills/{workspaceId}/post-views",
  },
  {
    operationId: "createQuillsRoadmap",
    method: "POST",
    path: "/api/quills/{workspaceId}/roadmaps",
  },
  {
    operationId: "createQuillsRoadmapColumn",
    method: "POST",
    path: "/api/quills/{workspaceId}/roadmaps/{roadmapId}/columns",
  },
  {
    operationId: "createQuillsSegment",
    method: "POST",
    path: "/api/quills/{workspaceId}/segments",
  },
  {
    operationId: "createQuillsSendingAddress",
    method: "POST",
    path: "/api/quills/{workspaceId}/support/email-channel/sending-addresses",
  },
  {
    operationId: "createQuillsSettingsReceiptsUndo",
    method: "POST",
    path: "/api/quills/{workspaceId}/settings/receipts/{receiptId}/undo",
  },
  {
    operationId: "createQuillsSettingsUpload",
    method: "POST",
    path: "/api/quills/{workspaceId}/files/settings-uploads",
  },
  {
    operationId: "createQuillsSkill",
    method: "POST",
    path: "/api/quills/{workspaceId}/assistant/skills",
  },
  {
    operationId: "createQuillsSlaPolicy",
    method: "POST",
    path: "/api/quills/{workspaceId}/sla-policies",
  },
  {
    operationId: "createQuillsSnippet",
    method: "POST",
    path: "/api/quills/{workspaceId}/assistant/snippets",
  },
  {
    operationId: "createQuillsStatus",
    method: "POST",
    path: "/api/quills/{workspaceId}/statuses",
  },
  {
    operationId: "createQuillsStatusComponent",
    method: "POST",
    path: "/api/quills/{workspaceId}/status/components",
  },
  {
    operationId: "createQuillsStatusGroup",
    method: "POST",
    path: "/api/quills/{workspaceId}/status/groups",
  },
  {
    operationId: "createQuillsStatusIncident",
    method: "POST",
    path: "/api/quills/{workspaceId}/status/incidents",
  },
  {
    operationId: "createQuillsStatusTemplate",
    method: "POST",
    path: "/api/quills/{workspaceId}/status/templates",
  },
  {
    operationId: "createQuillsSurvey",
    method: "POST",
    path: "/api/quills/{workspaceId}/surveys",
  },
  {
    operationId: "createQuillsTag",
    method: "POST",
    path: "/api/quills/{workspaceId}/tags",
  },
  {
    operationId: "createQuillsTicket",
    method: "POST",
    path: "/api/quills/{workspaceId}/tickets",
  },
  {
    operationId: "createQuillsTicketIssue",
    method: "POST",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/external-links/issue",
  },
  {
    operationId: "createQuillsTicketStatus",
    method: "POST",
    path: "/api/quills/{workspaceId}/ticket-statuses",
  },
  {
    operationId: "createQuillsTicketType",
    method: "POST",
    path: "/api/quills/{workspaceId}/ticket-types",
  },
  {
    operationId: "createQuillsTrack",
    method: "POST",
    path: "/api/quills-public/{workspace}/track",
  },
  {
    operationId: "createQuillsUnsubscribe",
    method: "POST",
    path: "/api/quills-public/{workspace}/unsubscribe",
  },
  {
    operationId: "createQuillsUpload",
    method: "POST",
    path: "/api/quills/{workspaceId}/files/uploads",
  },
  {
    operationId: "createQuillsUser",
    method: "POST",
    path: "/api/quills/{workspaceId}/users",
  },
  {
    operationId: "createQuillsUserAttribute",
    method: "POST",
    path: "/api/quills/{workspaceId}/user-attributes",
  },
  {
    operationId: "createQuillsWebhook",
    method: "POST",
    path: "/api/quills/{workspaceId}/webhooks",
  },
  {
    operationId: "createQuillsWidgetAnonymousSession",
    method: "POST",
    path: "/api/quills-public/{workspace}/widget/anonymous-session",
  },
  {
    operationId: "createQuillsWidgetComment",
    method: "POST",
    path: "/api/quills-public/{workspace}/widget/posts/{postId}/comments",
  },
  {
    operationId: "createQuillsWidgetFiles",
    method: "POST",
    path: "/api/quills-public/{workspace}/widget/files",
  },
  {
    operationId: "createQuillsWidgetKbAsk",
    method: "POST",
    path: "/api/quills-public/{workspace}/widget/kb-ask",
  },
  {
    operationId: "createQuillsWidgetMyTicket",
    method: "POST",
    path: "/api/quills-public/{workspace}/widget/tickets",
  },
  {
    operationId: "createQuillsWidgetPost",
    method: "POST",
    path: "/api/quills-public/{workspace}/widget/posts",
  },
  {
    operationId: "createQuillsWidgetUpload",
    method: "POST",
    path: "/api/quills-public/{workspace}/widget/uploads",
  },
  {
    operationId: "createQuillsWorkflow",
    method: "POST",
    path: "/api/quills/{workspaceId}/automation/workflows",
  },
  {
    operationId: "declineQuillsWebsiteBrandingOffer",
    method: "POST",
    path: "/api/quills/{workspaceId}/settings/website-branding/decline",
  },
  {
    operationId: "deleteQuillsAssistantDocument",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/assistant/documents/{documentId}",
  },
  {
    operationId: "deleteQuillsBoard",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/boards/{boardId}",
  },
  {
    operationId: "deleteQuillsChangelogCategory",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/changelog/categories/{categoryId}",
  },
  {
    operationId: "deleteQuillsChangelogEntry",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/changelog/{entryId}",
  },
  {
    operationId: "deleteQuillsChannelAccount",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/support/email-channel/sending-addresses/{channelAccountId}",
  },
  {
    operationId: "deleteQuillsComment",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/comments/{commentId}",
  },
  {
    operationId: "deleteQuillsCompany",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/companies/{companyId}",
  },
  {
    operationId: "deleteQuillsCompanyAttribute",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/company-attributes/{attributeId}",
  },
  {
    operationId: "deleteQuillsConnector",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/assistant/connectors/{connectorId}",
  },
  {
    operationId: "deleteQuillsConversationMessage",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/conversation-messages/{messageId}",
  },
  {
    operationId: "deleteQuillsConversationTag",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/conversation-tags/{tagId}/permanent",
  },
  {
    operationId: "deleteQuillsConversationView",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/conversation-views/{viewId}",
  },
  {
    operationId: "deleteQuillsCustomerAvatar",
    method: "DELETE",
    path: "/api/quills-public/{workspace}/user/avatar",
  },
  {
    operationId: "deleteQuillsFavicon",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/settings/favicon",
  },
  {
    operationId: "deleteQuillsGuidanceRule",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/assistant/guidance-rules/{ruleId}",
  },
  {
    operationId: "deleteQuillsHeaderLogo",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/settings/header-logo",
  },
  {
    operationId: "deleteQuillsHelpCenterArticle",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/help-center/articles/{articleId}",
  },
  {
    operationId: "deleteQuillsHelpCenterArticleTranslation",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/help-center/articles/{articleId}/translations",
  },
  {
    operationId: "deleteQuillsHelpCenterCategory",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/help-center/categories/{categoryId}",
  },
  {
    operationId: "deleteQuillsHelpCenterCategoryTranslation",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/help-center/categories/{categoryId}/translations",
  },
  {
    operationId: "deleteQuillsHelpCenterRedirectRule",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/help-center/redirect-rules/{ruleId}",
  },
  {
    operationId: "deleteQuillsIntegration",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/integrations/{integrationId}",
  },
  {
    operationId: "deleteQuillsLogo",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/settings/logo",
  },
  {
    operationId: "deleteQuillsMacro",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/macros/{macroId}",
  },
  {
    operationId: "deleteQuillsMyPostSubscription",
    method: "DELETE",
    path: "/api/quills-public/{workspace}/posts/{postId}/subscription",
  },
  {
    operationId: "deleteQuillsPlatformCredentials",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/integration-platform-credentials",
  },
  {
    operationId: "deleteQuillsPortalOwnComment",
    method: "DELETE",
    path: "/api/quills-public/{workspace}/portal/comments/{commentId}",
  },
  {
    operationId: "deleteQuillsPortalOwnPost",
    method: "DELETE",
    path: "/api/quills-public/{workspace}/portal/posts/{postId}",
  },
  {
    operationId: "deleteQuillsPost",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/posts/{postId}",
  },
  {
    operationId: "deleteQuillsPostSubscription",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/posts/{postId}/subscription",
  },
  {
    operationId: "deleteQuillsPostView",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/post-views/{viewId}",
  },
  {
    operationId: "deleteQuillsRoadmap",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/roadmaps/{roadmapId}",
  },
  {
    operationId: "deleteQuillsRoadmapColumn",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/roadmaps/{roadmapId}/columns/{columnId}",
  },
  {
    operationId: "deleteQuillsSegment",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/segments/{segmentId}",
  },
  {
    operationId: "deleteQuillsSendingDomain",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/support/email-channel/domains/{sendingDomainId}",
  },
  {
    operationId: "deleteQuillsSkill",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/assistant/skills/{skillId}",
  },
  {
    operationId: "deleteQuillsSnippet",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/assistant/snippets/{snippetId}",
  },
  {
    operationId: "deleteQuillsStatus",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/statuses/{statusId}",
  },
  {
    operationId: "deleteQuillsStatusComponent",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/status/components/{componentId}",
  },
  {
    operationId: "deleteQuillsStatusGroup",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/status/groups/{groupId}",
  },
  {
    operationId: "deleteQuillsStatusIncident",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/status/incidents/{incidentId}",
  },
  {
    operationId: "deleteQuillsStatusTemplate",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/status/templates/{templateId}",
  },
  {
    operationId: "deleteQuillsSurvey",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/surveys/{surveyId}",
  },
  {
    operationId: "deleteQuillsTag",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/tags/{tagId}",
  },
  {
    operationId: "deleteQuillsTeam",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/teams/{teamId}",
  },
  {
    operationId: "deleteQuillsTestConversations",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/test-conversations",
  },
  {
    operationId: "deleteQuillsTicketStatus",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/ticket-statuses/{statusId}",
  },
  {
    operationId: "deleteQuillsUser",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/users/{principalId}",
  },
  {
    operationId: "deleteQuillsUserAttribute",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/user-attributes/{attributeId}",
  },
  {
    operationId: "deleteQuillsWebhook",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/webhooks/{webhookId}",
  },
  {
    operationId: "deleteQuillsWebSource",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/assistant/web-sources/{webSourceId}",
  },
  {
    operationId: "deleteQuillsWidgetHeroImage",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/settings/widget/hero-image",
  },
  {
    operationId: "deleteQuillsWorkflow",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/automation/workflows/{workflowId}",
  },
  {
    operationId: "disableQuillsHelpCenterLocale",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/help-center/settings/locales",
  },
  {
    operationId: "disableQuillsStatusSync",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/integrations/{integrationId}/status-sync",
  },
  {
    operationId: "discardQuillsPortalFile",
    method: "DELETE",
    path: "/api/quills-public/{workspace}/portal/files/{fileId}",
  },
  {
    operationId: "dismissQuillsInboxTranslationSuggestion",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/translation/dismiss",
  },
  {
    operationId: "dismissQuillsSuggestion",
    method: "POST",
    path: "/api/quills/{workspaceId}/suggestions/{suggestionId}/dismiss",
  },
  {
    operationId: "draftQuillsAttributeDescriptions",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversation-attributes/description-draft",
  },
  {
    operationId: "editQuillsPortalOwnComment",
    method: "PUT",
    path: "/api/quills-public/{workspace}/portal/comments/{commentId}",
  },
  {
    operationId: "editQuillsPortalOwnPost",
    method: "PUT",
    path: "/api/quills-public/{workspace}/portal/posts/{postId}",
  },
  {
    operationId: "enableQuillsHelpCenterLocale",
    method: "PUT",
    path: "/api/quills/{workspaceId}/help-center/settings/locales",
  },
  {
    operationId: "enableQuillsStatusSync",
    method: "POST",
    path: "/api/quills/{workspaceId}/integrations/{integrationId}/status-sync",
  },
  {
    operationId: "endQuillsConversation",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/end",
  },
  {
    operationId: "evaluateQuillsAllSegments",
    method: "POST",
    path: "/api/quills/{workspaceId}/segments/evaluate",
  },
  {
    operationId: "evaluateQuillsMyPortalAccess",
    method: "GET",
    path: "/api/quills-public/{workspace}/portal/access",
  },
  {
    operationId: "evaluateQuillsSegment",
    method: "POST",
    path: "/api/quills/{workspaceId}/segments/{segmentId}/evaluate",
  },
  {
    operationId: "exportQuillsConversationTranscript",
    method: "GET",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/transcript",
  },
  {
    operationId: "exportQuillsStatusSubscribers",
    method: "GET",
    path: "/api/quills/{workspaceId}/status/subscribers/export",
  },
  {
    operationId: "fetchQuillsAdminOverview",
    method: "GET",
    path: "/api/quills/{workspaceId}/reporting/admin-overview",
  },
  {
    operationId: "fetchQuillsAssistantInboxCounts",
    method: "GET",
    path: "/api/quills/{workspaceId}/inbox/assistant-counts",
  },
  {
    operationId: "fetchQuillsInboxCounts",
    method: "GET",
    path: "/api/quills/{workspaceId}/inbox/counts",
  },
  {
    operationId: "fetchQuillsInboxSegmentsWithCounts",
    method: "GET",
    path: "/api/quills/{workspaceId}/inbox/segments",
  },
  {
    operationId: "fetchQuillsMergeSuggestionCountsForPosts",
    method: "GET",
    path: "/api/quills/{workspaceId}/merge-suggestions/counts",
  },
  {
    operationId: "fetchQuillsMergeSuggestionSummary",
    method: "GET",
    path: "/api/quills/{workspaceId}/merge-suggestions/summary",
  },
  {
    operationId: "findQuillsPortalSimilarPosts",
    method: "GET",
    path: "/api/quills-public/{workspace}/portal/posts/similar",
  },
  {
    operationId: "findQuillsUsersByEmail",
    method: "GET",
    path: "/api/quills/{workspaceId}/users/by-email",
  },
  {
    operationId: "findQuillsWidgetSimilarPosts",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/posts/similar",
  },
  {
    operationId: "getQuillsAnalyticsData",
    method: "GET",
    path: "/api/quills/{workspaceId}/reporting/analytics",
  },
  {
    operationId: "getQuillsAssistantPendingAction",
    method: "GET",
    path: "/api/quills/{workspaceId}/assistant/pending-actions/{actionId}",
  },
  {
    operationId: "getQuillsAssistantRun",
    method: "GET",
    path: "/api/quills/{workspaceId}/assistant/runs/{runId}",
  },
  {
    operationId: "getQuillsAssistantSettings",
    method: "GET",
    path: "/api/quills/{workspaceId}/assistant/settings",
  },
  {
    operationId: "getQuillsAutomaticWebsiteBrandingStatus",
    method: "GET",
    path: "/api/quills/{workspaceId}/settings/website-branding",
  },
  {
    operationId: "getQuillsBoard",
    method: "GET",
    path: "/api/quills/{workspaceId}/boards/{boardId}",
  },
  {
    operationId: "getQuillsBrandingSettings",
    method: "GET",
    path: "/api/quills/{workspaceId}/settings/branding",
  },
  {
    operationId: "getQuillsChangelogEntry",
    method: "GET",
    path: "/api/quills/{workspaceId}/changelog/{entryId}",
  },
  {
    operationId: "getQuillsChangelogSettings",
    method: "GET",
    path: "/api/quills/{workspaceId}/changelog/settings",
  },
  {
    operationId: "getQuillsChangelogSubscriber",
    method: "GET",
    path: "/api/quills/{workspaceId}/changelog-subscribers/{principalId}",
  },
  {
    operationId: "getQuillsComment",
    method: "GET",
    path: "/api/quills/{workspaceId}/comments/{commentId}",
  },
  {
    operationId: "getQuillsCompany",
    method: "GET",
    path: "/api/quills/{workspaceId}/companies/{companyId}",
  },
  {
    operationId: "getQuillsCompanyActivity",
    method: "GET",
    path: "/api/quills/{workspaceId}/companies/{companyId}/activity",
  },
  {
    operationId: "getQuillsConnector",
    method: "GET",
    path: "/api/quills/{workspaceId}/assistant/connectors/{connectorId}",
  },
  {
    operationId: "getQuillsConversation",
    method: "GET",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}",
  },
  {
    operationId: "getQuillsConversationAssistantActivity",
    method: "GET",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/assistant-activity",
  },
  {
    operationId: "getQuillsConversationLinkedTicket",
    method: "GET",
    path: "/api/quills-public/{workspace}/support/conversations/{conversationId}/ticket",
  },
  {
    operationId: "getQuillsConversationPresence",
    method: "GET",
    path: "/api/quills-public/{workspace}/support/presence",
  },
  {
    operationId: "getQuillsConversationRouting",
    method: "GET",
    path: "/api/quills/{workspaceId}/support/routing",
  },
  {
    operationId: "getQuillsConversationTyping",
    method: "GET",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/typing",
  },
  {
    operationId: "getQuillsCopilotUsageMetrics",
    method: "GET",
    path: "/api/quills/{workspaceId}/assistant/analytics/copilot",
  },
  {
    operationId: "getQuillsCustomerAvatar",
    method: "GET",
    path: "/api/quills-public/{workspace}/user/avatar/{customerId}",
  },
  {
    operationId: "getQuillsCustomerContext",
    method: "GET",
    path: "/api/quills/{workspaceId}/people/{principalId}/context",
  },
  {
    operationId: "getQuillsCustomerProfile",
    method: "GET",
    path: "/api/quills-public/{workspace}/user/profile",
  },
  {
    operationId: "getQuillsDefaultSlaPolicy",
    method: "GET",
    path: "/api/quills/{workspaceId}/support/default-sla-policy",
  },
  {
    operationId: "getQuillsDeveloperSettings",
    method: "GET",
    path: "/api/quills/{workspaceId}/settings/developer",
  },
  {
    operationId: "getQuillsEmailAutoAck",
    method: "GET",
    path: "/api/quills/{workspaceId}/support/email-auto-ack",
  },
  {
    operationId: "getQuillsEmailChangeState",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/contact-email",
  },
  {
    operationId: "getQuillsEmailChannelConfig",
    method: "GET",
    path: "/api/quills/{workspaceId}/support/email-channel",
  },
  {
    operationId: "getQuillsEmailChannelStatus",
    method: "GET",
    path: "/api/quills/{workspaceId}/support/email-channel/status",
  },
  {
    operationId: "getQuillsEmbedPreview",
    method: "GET",
    path: "/api/quills-public/{workspace}/portal/embed-preview",
  },
  {
    operationId: "getQuillsExportRuns",
    method: "GET",
    path: "/api/quills/{workspaceId}/transfer/export-runs/{runId}",
  },
  {
    operationId: "getQuillsFeatureFlagSettings",
    method: "GET",
    path: "/api/quills/{workspaceId}/settings/labs",
  },
  {
    operationId: "getQuillsFile",
    method: "GET",
    path: "/api/quills/{workspaceId}/files/{fileId}",
  },
  {
    operationId: "getQuillsGitHubChannelStatus",
    method: "GET",
    path: "/api/quills/{workspaceId}/channels/github",
  },
  {
    operationId: "getQuillsGuidanceRuleStats",
    method: "GET",
    path: "/api/quills/{workspaceId}/assistant/guidance-rules/stats",
  },
  {
    operationId: "getQuillsHelpCenterArticle",
    method: "GET",
    path: "/api/quills/{workspaceId}/help-center/articles/{articleId}",
  },
  {
    operationId: "getQuillsHelpCenterCategory",
    method: "GET",
    path: "/api/quills/{workspaceId}/help-center/categories/{categoryId}",
  },
  {
    operationId: "getQuillsHelpCenterSettings",
    method: "GET",
    path: "/api/quills/{workspaceId}/help-center/settings",
  },
  {
    operationId: "getQuillsImportRuns",
    method: "GET",
    path: "/api/quills/{workspaceId}/transfer/import-runs/{runId}",
  },
  {
    operationId: "getQuillsIntegration",
    method: "GET",
    path: "/api/quills/{workspaceId}/integrations/{integrationId}",
  },
  {
    operationId: "getQuillsLinkedConversationsForPost",
    method: "GET",
    path: "/api/quills/{workspaceId}/posts/{postId}/conversations",
  },
  {
    operationId: "getQuillsLinkedPostsForConversation",
    method: "GET",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/posts",
  },
  {
    operationId: "getQuillsMergeSuggestionsForPost",
    method: "GET",
    path: "/api/quills/{workspaceId}/posts/{postId}/merge-suggestions",
  },
  {
    operationId: "getQuillsModerationStatus",
    method: "GET",
    path: "/api/quills/{workspaceId}/moderation/status",
  },
  {
    operationId: "getQuillsMyChangelogSubscription",
    method: "GET",
    path: "/api/quills-public/{workspace}/changelog/subscription",
  },
  {
    operationId: "getQuillsMyConversation",
    method: "GET",
    path: "/api/quills-public/{workspace}/support/conversations/{conversationId}",
  },
  {
    operationId: "getQuillsMyLanguagePreference",
    method: "GET",
    path: "/api/quills-public/{workspace}/user/language",
  },
  {
    operationId: "getQuillsMyPostSubscription",
    method: "GET",
    path: "/api/quills-public/{workspace}/posts/{postId}/subscription",
  },
  {
    operationId: "getQuillsMyStatusSubscription",
    method: "GET",
    path: "/api/quills-public/{workspace}/status/subscription",
  },
  {
    operationId: "getQuillsMyTicketForm",
    method: "GET",
    path: "/api/quills-public/{workspace}/support/ticket-form",
  },
  {
    operationId: "getQuillsMyTickets",
    method: "GET",
    path: "/api/quills-public/{workspace}/support/tickets",
  },
  {
    operationId: "getQuillsMyTicketStageLabels",
    method: "GET",
    path: "/api/quills-public/{workspace}/support/ticket-stage-labels",
  },
  {
    operationId: "getQuillsMyTicketWatchStatus",
    method: "GET",
    path: "/api/quills-public/{workspace}/support/tickets/{ticketId}/watch",
  },
  {
    operationId: "getQuillsMyUnreadCount",
    method: "GET",
    path: "/api/quills-public/{workspace}/support/unread",
  },
  {
    operationId: "getQuillsNotificationPreferences",
    method: "GET",
    path: "/api/quills/{workspaceId}/notification-preferences",
  },
  {
    operationId: "getQuillsNotificationUnreadCount",
    method: "GET",
    path: "/api/quills/{workspaceId}/notifications/unread-count",
  },
  {
    operationId: "getQuillsOfficeHours",
    method: "GET",
    path: "/api/quills/{workspaceId}/support/office-hours",
  },
  {
    operationId: "getQuillsPlatformCredentials",
    method: "GET",
    path: "/api/quills/{workspaceId}/integration-platform-credentials",
  },
  {
    operationId: "getQuillsPortalActiveSurvey",
    method: "GET",
    path: "/api/quills-public/{workspace}/portal/surveys/active",
  },
  {
    operationId: "getQuillsPortalChangelogEntry",
    method: "GET",
    path: "/api/quills-public/{workspace}/portal/changelog/{entryId}",
  },
  {
    operationId: "getQuillsPortalFile",
    method: "GET",
    path: "/api/quills-public/{workspace}/portal/files/{fileId}",
  },
  {
    operationId: "getQuillsPortalPost",
    method: "GET",
    path: "/api/quills-public/{workspace}/portal/posts/{postId}",
  },
  {
    operationId: "getQuillsPortalSettings",
    method: "GET",
    path: "/api/quills/{workspaceId}/settings/portal",
  },
  {
    operationId: "getQuillsPortalUserStats",
    method: "GET",
    path: "/api/quills-public/{workspace}/portal/user/stats",
  },
  {
    operationId: "getQuillsPost",
    method: "GET",
    path: "/api/quills/{workspaceId}/posts/{postId}",
  },
  {
    operationId: "getQuillsPostFilterCounts",
    method: "GET",
    path: "/api/quills/{workspaceId}/posts/counts",
  },
  {
    operationId: "getQuillsPostMergePreview",
    method: "GET",
    path: "/api/quills/{workspaceId}/posts/{postId}/merge-preview",
  },
  {
    operationId: "getQuillsPostSentiment",
    method: "GET",
    path: "/api/quills/{workspaceId}/posts/{postId}/sentiment",
  },
  {
    operationId: "getQuillsPostSubscription",
    method: "GET",
    path: "/api/quills/{workspaceId}/posts/{postId}/subscription",
  },
  {
    operationId: "getQuillsPoweredBy",
    method: "GET",
    path: "/api/quills/{workspaceId}/operations/powered-by",
  },
  {
    operationId: "getQuillsPrincipal",
    method: "GET",
    path: "/api/quills/{workspaceId}/principals/{principalId}",
  },
  {
    operationId: "getQuillsProfileTeamContext",
    method: "GET",
    path: "/api/quills/{workspaceId}/profiles/{principalId}/team-context",
  },
  {
    operationId: "getQuillsPublicChangelogFeed",
    method: "GET",
    path: "/api/quills-public/{workspace}/changelog/rss.xml",
  },
  {
    operationId: "getQuillsPublicHelpCenter",
    method: "GET",
    path: "/api/quills-public/{workspace}/hc",
  },
  {
    operationId: "getQuillsPublicHelpCenterArticle",
    method: "GET",
    path: "/api/quills-public/{workspace}/hc/articles/{idSlug}",
  },
  {
    operationId: "getQuillsPublicHelpCenterCategory",
    method: "GET",
    path: "/api/quills-public/{workspace}/hc/categories/{categorySlug}",
  },
  {
    operationId: "getQuillsPublicHelpCenterCollection",
    method: "GET",
    path: "/api/quills-public/{workspace}/hc/collections/{idSlug}",
  },
  {
    operationId: "getQuillsPublicHelpCenterSitemap",
    method: "GET",
    path: "/api/quills-public/{workspace}/hc/sitemap.xml",
  },
  {
    operationId: "getQuillsPublicPortalConfig",
    method: "GET",
    path: "/api/quills-public/{workspace}/portal/config",
  },
  {
    operationId: "getQuillsPublicSitemap",
    method: "GET",
    path: "/api/quills-public/{workspace}/sitemap.xml",
  },
  {
    operationId: "getQuillsPublicStatusIncident",
    method: "GET",
    path: "/api/quills-public/{workspace}/status/incidents/{incidentId}",
  },
  {
    operationId: "getQuillsPublicStatusPage",
    method: "GET",
    path: "/api/quills-public/{workspace}/status",
  },
  {
    operationId: "getQuillsPublicStatusUptime",
    method: "GET",
    path: "/api/quills-public/{workspace}/status/uptime",
  },
  {
    operationId: "getQuillsPublicUserProfile",
    method: "GET",
    path: "/api/quills-public/{workspace}/portal/profiles/{principalId}",
  },
  {
    operationId: "getQuillsQuinnPerformance",
    method: "GET",
    path: "/api/quills/{workspaceId}/assistant/analytics/performance",
  },
  {
    operationId: "getQuillsQuinnToolMetrics",
    method: "GET",
    path: "/api/quills/{workspaceId}/assistant/analytics/tools",
  },
  {
    operationId: "getQuillsRoadmap",
    method: "GET",
    path: "/api/quills/{workspaceId}/roadmaps/{roadmapId}",
  },
  {
    operationId: "getQuillsSlackAgentSettings",
    method: "GET",
    path: "/api/quills/{workspaceId}/assistant/slack",
  },
  {
    operationId: "getQuillsSlaOfficeHours",
    method: "GET",
    path: "/api/quills/{workspaceId}/sla-policies/office-hours",
  },
  {
    operationId: "getQuillsSpamFilterConfig",
    method: "GET",
    path: "/api/quills/{workspaceId}/support/spam-filter",
  },
  {
    operationId: "getQuillsStatus",
    method: "GET",
    path: "/api/quills/{workspaceId}/statuses/{statusId}",
  },
  {
    operationId: "getQuillsStatusComponent",
    method: "GET",
    path: "/api/quills/{workspaceId}/status/components/{componentId}",
  },
  {
    operationId: "getQuillsStatusIncident",
    method: "GET",
    path: "/api/quills/{workspaceId}/status/incidents/{incidentId}",
  },
  {
    operationId: "getQuillsStatusSettings",
    method: "GET",
    path: "/api/quills/{workspaceId}/status/settings",
  },
  {
    operationId: "getQuillsStatusSummary",
    method: "GET",
    path: "/api/quills/{workspaceId}/status/summary",
  },
  {
    operationId: "getQuillsStatusSync",
    method: "GET",
    path: "/api/quills/{workspaceId}/integrations/{integrationId}/status-sync",
  },
  {
    operationId: "getQuillsStatusUptime",
    method: "GET",
    path: "/api/quills/{workspaceId}/status/uptime",
  },
  {
    operationId: "getQuillsSupportReporting",
    method: "GET",
    path: "/api/quills/{workspaceId}/support/reporting",
  },
  {
    operationId: "getQuillsSurveyResults",
    method: "GET",
    path: "/api/quills/{workspaceId}/surveys/{surveyId}/results",
  },
  {
    operationId: "getQuillsTag",
    method: "GET",
    path: "/api/quills/{workspaceId}/tags/{tagId}",
  },
  {
    operationId: "getQuillsTicket",
    method: "GET",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}",
  },
  {
    operationId: "getQuillsTicketLinks",
    method: "GET",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/links",
  },
  {
    operationId: "getQuillsTicketStageLabels",
    method: "GET",
    path: "/api/quills/{workspaceId}/ticket-stage-labels",
  },
  {
    operationId: "getQuillsTicketSummary",
    method: "GET",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/summary",
  },
  {
    operationId: "getQuillsTicketWatchStatus",
    method: "GET",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/watch",
  },
  {
    operationId: "getQuillsUsage",
    method: "GET",
    path: "/api/quills/{workspaceId}/operations/usage",
  },
  {
    operationId: "getQuillsUser",
    method: "GET",
    path: "/api/quills/{workspaceId}/users/{principalId}",
  },
  {
    operationId: "getQuillsUserBlock",
    method: "GET",
    path: "/api/quills/{workspaceId}/users/{principalId}/block",
  },
  {
    operationId: "getQuillsUserCompany",
    method: "GET",
    path: "/api/quills/{workspaceId}/users/{principalId}/company",
  },
  {
    operationId: "getQuillsVisitorAnalyticsData",
    method: "GET",
    path: "/api/quills/{workspaceId}/reporting/visitor-analytics",
  },
  {
    operationId: "getQuillsWebhook",
    method: "GET",
    path: "/api/quills/{workspaceId}/webhooks/{webhookId}",
  },
  {
    operationId: "getQuillsWidgetActiveSurvey",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/surveys/active",
  },
  {
    operationId: "getQuillsWidgetCapabilities",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/capabilities",
  },
  {
    operationId: "getQuillsWidgetChangelogEntry",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/changelog/{entryId}",
  },
  {
    operationId: "getQuillsWidgetConfig",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/config.json",
  },
  {
    operationId: "getQuillsWidgetConversation",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/conversations/{conversationId}",
  },
  {
    operationId: "getQuillsWidgetConversationLinkedTicket",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/conversations/{conversationId}/ticket",
  },
  {
    operationId: "getQuillsWidgetEmbedPreview",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/embed-preview",
  },
  {
    operationId: "getQuillsWidgetHelpArticle",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/help/articles/{ref}",
  },
  {
    operationId: "getQuillsWidgetKbAsk",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/kb-ask/{runId}",
  },
  {
    operationId: "getQuillsWidgetLocale",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/locale",
  },
  {
    operationId: "getQuillsWidgetMyTicketForm",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/ticket-form",
  },
  {
    operationId: "getQuillsWidgetMyTickets",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/tickets",
  },
  {
    operationId: "getQuillsWidgetMyTicketStageLabels",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/ticket-stage-labels",
  },
  {
    operationId: "getQuillsWidgetMyTicketWatchStatus",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/tickets/{ticketId}/watch",
  },
  {
    operationId: "getQuillsWidgetPost",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/posts/{postId}",
  },
  {
    operationId: "getQuillsWidgetPresence",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/presence",
  },
  {
    operationId: "getQuillsWidgetSecret",
    method: "GET",
    path: "/api/quills/{workspaceId}/settings/widget/secret",
  },
  {
    operationId: "getQuillsWidgetSession",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/session",
  },
  {
    operationId: "getQuillsWidgetSettings",
    method: "GET",
    path: "/api/quills/{workspaceId}/settings/widget",
  },
  {
    operationId: "getQuillsWidgetUnreadCount",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/unread",
  },
  {
    operationId: "getQuillsWidgetUserStats",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/user/stats",
  },
  {
    operationId: "getQuillsWorkflow",
    method: "GET",
    path: "/api/quills/{workspaceId}/automation/workflows/{workflowId}",
  },
  {
    operationId: "getQuillsWorkflowAbandonedAutoClose",
    method: "GET",
    path: "/api/quills/{workspaceId}/automation/settings/abandoned-auto-close",
  },
  {
    operationId: "getQuillsWorkflowCloseSpam",
    method: "GET",
    path: "/api/quills/{workspaceId}/automation/settings/close-spam",
  },
  {
    operationId: "getQuillsWorkflowEffectiveness",
    method: "GET",
    path: "/api/quills/{workspaceId}/automation/effectiveness",
  },
  {
    operationId: "getQuillsWorkspaceContext",
    method: "GET",
    path: "/api/quills/{workspaceId}/context",
  },
  {
    operationId: "identifyQuillsUser",
    method: "POST",
    path: "/api/quills/{workspaceId}/users/identify",
  },
  {
    operationId: "identifyQuillsWidgetVisitor",
    method: "POST",
    path: "/api/quills-public/{workspace}/widget/identify",
  },
  {
    operationId: "importQuillsChangelogSubscribers",
    method: "POST",
    path: "/api/quills/{workspaceId}/changelog-subscribers/import",
  },
  {
    operationId: "importQuillsStatusSubscribers",
    method: "POST",
    path: "/api/quills/{workspaceId}/status/subscribers/import",
  },
  {
    operationId: "inspectQuillsIntegrationSync",
    method: "GET",
    path: "/api/quills/{workspaceId}/integration-syncs/{syncId}",
  },
  {
    operationId: "linkQuillsAppPost",
    method: "PUT",
    path: "/api/quills/{workspaceId}/apps/links",
  },
  {
    operationId: "linkQuillsBoardToProject",
    method: "PUT",
    path: "/api/quills/{workspaceId}/boards/{boardId}/projects/{projectId}",
  },
  {
    operationId: "linkQuillsPostToTask",
    method: "PUT",
    path: "/api/quills/{workspaceId}/posts/{postId}/tasks/{taskId}",
  },
  {
    operationId: "linkQuillsTicketIssue",
    method: "PUT",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/external-links",
  },
  {
    operationId: "linkQuillsTicketToConversation",
    method: "PUT",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/conversations/{conversationId}",
  },
  {
    operationId: "linkQuillsTicketToTracker",
    method: "PUT",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/tracker/{trackerTicketId}",
  },
  {
    operationId: "linkQuillsWidgetDevice",
    method: "POST",
    path: "/api/quills-public/{workspace}/widget/device",
  },
  {
    operationId: "listQuillsAppBoards",
    method: "GET",
    path: "/api/quills/{workspaceId}/apps/boards",
  },
  {
    operationId: "listQuillsAppLinkedPosts",
    method: "GET",
    path: "/api/quills/{workspaceId}/apps/links",
  },
  {
    operationId: "listQuillsAppRegistrations",
    method: "GET",
    path: "/api/quills/{workspaceId}/app-registrations",
  },
  {
    operationId: "listQuillsAssistantDocuments",
    method: "GET",
    path: "/api/quills/{workspaceId}/assistant/documents",
  },
  {
    operationId: "listQuillsAssistantPendingActions",
    method: "GET",
    path: "/api/quills/{workspaceId}/assistant/pending-actions",
  },
  {
    operationId: "listQuillsAssistantTools",
    method: "GET",
    path: "/api/quills/{workspaceId}/assistant/tools",
  },
  {
    operationId: "listQuillsAuditEvents",
    method: "GET",
    path: "/api/quills/{workspaceId}/audit-events",
  },
  {
    operationId: "listQuillsBoards",
    method: "GET",
    path: "/api/quills/{workspaceId}/boards",
  },
  {
    operationId: "listQuillsChangelog",
    method: "GET",
    path: "/api/quills/{workspaceId}/changelog",
  },
  {
    operationId: "listQuillsChangelogCategories",
    method: "GET",
    path: "/api/quills/{workspaceId}/changelog/categories",
  },
  {
    operationId: "listQuillsCompanies",
    method: "GET",
    path: "/api/quills/{workspaceId}/companies",
  },
  {
    operationId: "listQuillsCompanyAttributes",
    method: "GET",
    path: "/api/quills/{workspaceId}/company-attributes",
  },
  {
    operationId: "listQuillsCompanyMembers",
    method: "GET",
    path: "/api/quills/{workspaceId}/companies/{companyId}/members",
  },
  {
    operationId: "listQuillsConnectors",
    method: "GET",
    path: "/api/quills/{workspaceId}/assistant/connectors",
  },
  {
    operationId: "listQuillsConversationAttributes",
    method: "GET",
    path: "/api/quills/{workspaceId}/conversation-attributes",
  },
  {
    operationId: "listQuillsConversationFiles",
    method: "GET",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/files",
  },
  {
    operationId: "listQuillsConversationMessages",
    method: "GET",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/messages",
  },
  {
    operationId: "listQuillsConversationParticipants",
    method: "GET",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/participants",
  },
  {
    operationId: "listQuillsConversations",
    method: "GET",
    path: "/api/quills/{workspaceId}/conversations",
  },
  {
    operationId: "listQuillsConversationTags",
    method: "GET",
    path: "/api/quills/{workspaceId}/conversation-tags",
  },
  {
    operationId: "listQuillsConversationTagUsage",
    method: "GET",
    path: "/api/quills/{workspaceId}/conversation-tags/usage",
  },
  {
    operationId: "listQuillsConversationViews",
    method: "GET",
    path: "/api/quills/{workspaceId}/conversation-views",
  },
  {
    operationId: "listQuillsCustomDomains",
    method: "GET",
    path: "/api/quills/{workspaceId}/operations/domains",
  },
  {
    operationId: "listQuillsExportRuns",
    method: "GET",
    path: "/api/quills/{workspaceId}/transfer/export-runs",
  },
  {
    operationId: "listQuillsExportRunsDownload",
    method: "GET",
    path: "/api/quills/{workspaceId}/transfer/export-runs/{runId}/download",
  },
  {
    operationId: "listQuillsFlaggedMessages",
    method: "GET",
    path: "/api/quills/{workspaceId}/conversation-messages/flagged",
  },
  {
    operationId: "listQuillsGuidanceRules",
    method: "GET",
    path: "/api/quills/{workspaceId}/assistant/guidance-rules",
  },
  {
    operationId: "listQuillsHelpCenterArticleFeedbackReasons",
    method: "GET",
    path: "/api/quills/{workspaceId}/help-center/articles/{articleId}/feedback-reasons",
  },
  {
    operationId: "listQuillsHelpCenterArticlePerformance",
    method: "GET",
    path: "/api/quills/{workspaceId}/help-center/analytics/articles",
  },
  {
    operationId: "listQuillsHelpCenterArticles",
    method: "GET",
    path: "/api/quills/{workspaceId}/help-center/articles",
  },
  {
    operationId: "listQuillsHelpCenterArticleTranslations",
    method: "GET",
    path: "/api/quills/{workspaceId}/help-center/articles/{articleId}/translations",
  },
  {
    operationId: "listQuillsHelpCenterCategories",
    method: "GET",
    path: "/api/quills/{workspaceId}/help-center/categories",
  },
  {
    operationId: "listQuillsHelpCenterCategoryTranslations",
    method: "GET",
    path: "/api/quills/{workspaceId}/help-center/categories/{categoryId}/translations",
  },
  {
    operationId: "listQuillsHelpCenterRedirectRules",
    method: "GET",
    path: "/api/quills/{workspaceId}/help-center/redirect-rules",
  },
  {
    operationId: "listQuillsHelpCenterSearchTerms",
    method: "GET",
    path: "/api/quills/{workspaceId}/help-center/analytics/search-terms",
  },
  {
    operationId: "listQuillsImportRuns",
    method: "GET",
    path: "/api/quills/{workspaceId}/transfer/import-runs",
  },
  {
    operationId: "listQuillsInboxItems",
    method: "GET",
    path: "/api/quills/{workspaceId}/inbox",
  },
  {
    operationId: "listQuillsIntegrationCatalog",
    method: "GET",
    path: "/api/quills/{workspaceId}/integration-catalog",
  },
  {
    operationId: "listQuillsIntegrationDestinations",
    method: "GET",
    path: "/api/quills/{workspaceId}/integrations/{integrationId}/destinations",
  },
  {
    operationId: "listQuillsIntegrations",
    method: "GET",
    path: "/api/quills/{workspaceId}/integrations",
  },
  {
    operationId: "listQuillsIntegrationSyncHistory",
    method: "GET",
    path: "/api/quills/{workspaceId}/integrations/{integrationId}/syncs",
  },
  {
    operationId: "listQuillsJobs",
    method: "GET",
    path: "/api/quills/{workspaceId}/jobs",
  },
  {
    operationId: "listQuillsLinks",
    method: "GET",
    path: "/api/quills/{workspaceId}/links",
  },
  {
    operationId: "listQuillsMacros",
    method: "GET",
    path: "/api/quills/{workspaceId}/macros",
  },
  {
    operationId: "listQuillsMentionSuggestions",
    method: "GET",
    path: "/api/quills/{workspaceId}/mentions/suggest",
  },
  {
    operationId: "listQuillsMergedPosts",
    method: "GET",
    path: "/api/quills/{workspaceId}/posts/{postId}/merged",
  },
  {
    operationId: "listQuillsMyConversationMessages",
    method: "GET",
    path: "/api/quills-public/{workspace}/support/conversations/{conversationId}/messages",
  },
  {
    operationId: "listQuillsMyConversations",
    method: "GET",
    path: "/api/quills-public/{workspace}/support/conversations",
  },
  {
    operationId: "listQuillsNotifications",
    method: "GET",
    path: "/api/quills/{workspaceId}/notifications",
  },
  {
    operationId: "listQuillsPendingModeration",
    method: "GET",
    path: "/api/quills/{workspaceId}/moderation/pending",
  },
  {
    operationId: "listQuillsPortalBoards",
    method: "GET",
    path: "/api/quills-public/{workspace}/portal/boards",
  },
  {
    operationId: "listQuillsPortalChangelog",
    method: "GET",
    path: "/api/quills-public/{workspace}/portal/changelog",
  },
  {
    operationId: "listQuillsPortalInvites",
    method: "GET",
    path: "/api/quills/{workspaceId}/portal/invites",
  },
  {
    operationId: "listQuillsPortalMentionSuggestions",
    method: "GET",
    path: "/api/quills-public/{workspace}/mentions/suggest",
  },
  {
    operationId: "listQuillsPortalPostComments",
    method: "GET",
    path: "/api/quills-public/{workspace}/portal/posts/{postId}/comments",
  },
  {
    operationId: "listQuillsPortalPosts",
    method: "GET",
    path: "/api/quills-public/{workspace}/portal/posts",
  },
  {
    operationId: "listQuillsPortalRoadmapPosts",
    method: "GET",
    path: "/api/quills-public/{workspace}/portal/roadmaps/{roadmapId}/posts",
  },
  {
    operationId: "listQuillsPortalRoadmaps",
    method: "GET",
    path: "/api/quills-public/{workspace}/portal/roadmaps",
  },
  {
    operationId: "listQuillsPortalStatuses",
    method: "GET",
    path: "/api/quills-public/{workspace}/portal/statuses",
  },
  {
    operationId: "listQuillsPortalTags",
    method: "GET",
    path: "/api/quills-public/{workspace}/portal/tags",
  },
  {
    operationId: "listQuillsPortalVotedPosts",
    method: "GET",
    path: "/api/quills-public/{workspace}/portal/voted-posts",
  },
  {
    operationId: "listQuillsPostActivity",
    method: "GET",
    path: "/api/quills/{workspaceId}/posts/{postId}/activity",
  },
  {
    operationId: "listQuillsPostComments",
    method: "GET",
    path: "/api/quills/{workspaceId}/posts/{postId}/comments",
  },
  {
    operationId: "listQuillsPostExternalLinks",
    method: "GET",
    path: "/api/quills/{workspaceId}/posts/{postId}/external-links",
  },
  {
    operationId: "listQuillsPostOwnerCandidates",
    method: "GET",
    path: "/api/quills/{workspaceId}/posts/owner-candidates",
  },
  {
    operationId: "listQuillsPosts",
    method: "GET",
    path: "/api/quills/{workspaceId}/posts",
  },
  {
    operationId: "listQuillsPostViews",
    method: "GET",
    path: "/api/quills/{workspaceId}/post-views",
  },
  {
    operationId: "listQuillsPostVoters",
    method: "GET",
    path: "/api/quills/{workspaceId}/posts/{postId}/voters",
  },
  {
    operationId: "listQuillsPrincipals",
    method: "GET",
    path: "/api/quills/{workspaceId}/principals",
  },
  {
    operationId: "listQuillsPublicHelpCenterCategoryArticles",
    method: "GET",
    path: "/api/quills-public/{workspace}/hc/categories/{categoryId}/articles",
  },
  {
    operationId: "listQuillsPublicHelpCenterEditors",
    method: "GET",
    path: "/api/quills-public/{workspace}/hc/editors",
  },
  {
    operationId: "listQuillsPublicStatusFeed",
    method: "GET",
    path: "/api/quills-public/{workspace}/status/rss.xml",
  },
  {
    operationId: "listQuillsPublicStatusHistory",
    method: "GET",
    path: "/api/quills-public/{workspace}/status/history",
  },
  {
    operationId: "listQuillsRecentEmailLog",
    method: "GET",
    path: "/api/quills/{workspaceId}/support/email-log",
  },
  {
    operationId: "listQuillsRoadmapColumns",
    method: "GET",
    path: "/api/quills/{workspaceId}/roadmaps/{roadmapId}/columns",
  },
  {
    operationId: "listQuillsRoadmapPosts",
    method: "GET",
    path: "/api/quills/{workspaceId}/roadmaps/{roadmapId}/posts",
  },
  {
    operationId: "listQuillsRoadmaps",
    method: "GET",
    path: "/api/quills/{workspaceId}/roadmaps",
  },
  {
    operationId: "listQuillsRunnableWorkflows",
    method: "GET",
    path: "/api/quills/{workspaceId}/automation/runnable-workflows",
  },
  {
    operationId: "listQuillsSegmentAttributeValues",
    method: "GET",
    path: "/api/quills/{workspaceId}/segments/attribute-values",
  },
  {
    operationId: "listQuillsSegments",
    method: "GET",
    path: "/api/quills/{workspaceId}/segments",
  },
  {
    operationId: "listQuillsSendingDomains",
    method: "GET",
    path: "/api/quills/{workspaceId}/operations/domains/sending",
  },
  {
    operationId: "listQuillsSettings",
    method: "GET",
    path: "/api/quills/{workspaceId}/settings",
  },
  {
    operationId: "listQuillsSimilarPosts",
    method: "GET",
    path: "/api/quills/{workspaceId}/posts/{postId}/similar",
  },
  {
    operationId: "listQuillsSkills",
    method: "GET",
    path: "/api/quills/{workspaceId}/assistant/skills",
  },
  {
    operationId: "listQuillsSlaPolicies",
    method: "GET",
    path: "/api/quills/{workspaceId}/sla-policies",
  },
  {
    operationId: "listQuillsSlaPolicyOptions",
    method: "GET",
    path: "/api/quills/{workspaceId}/sla-policies/options",
  },
  {
    operationId: "listQuillsSnippets",
    method: "GET",
    path: "/api/quills/{workspaceId}/assistant/snippets",
  },
  {
    operationId: "listQuillsStatusComponents",
    method: "GET",
    path: "/api/quills/{workspaceId}/status/components",
  },
  {
    operationId: "listQuillsStatuses",
    method: "GET",
    path: "/api/quills/{workspaceId}/statuses",
  },
  {
    operationId: "listQuillsStatusIncidents",
    method: "GET",
    path: "/api/quills/{workspaceId}/status/incidents",
  },
  {
    operationId: "listQuillsStatusSubscribers",
    method: "GET",
    path: "/api/quills/{workspaceId}/status/subscribers",
  },
  {
    operationId: "listQuillsStatusTemplates",
    method: "GET",
    path: "/api/quills/{workspaceId}/status/templates",
  },
  {
    operationId: "listQuillsSurveys",
    method: "GET",
    path: "/api/quills/{workspaceId}/surveys",
  },
  {
    operationId: "listQuillsTags",
    method: "GET",
    path: "/api/quills/{workspaceId}/tags",
  },
  {
    operationId: "listQuillsTeams",
    method: "GET",
    path: "/api/quills/{workspaceId}/teams",
  },
  {
    operationId: "listQuillsTicketActivity",
    method: "GET",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/activity",
  },
  {
    operationId: "listQuillsTicketConversations",
    method: "GET",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/conversations",
  },
  {
    operationId: "listQuillsTicketExternalLinks",
    method: "GET",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/external-links",
  },
  {
    operationId: "listQuillsTicketMessages",
    method: "GET",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/messages",
  },
  {
    operationId: "listQuillsTickets",
    method: "GET",
    path: "/api/quills/{workspaceId}/tickets",
  },
  {
    operationId: "listQuillsTicketStatuses",
    method: "GET",
    path: "/api/quills/{workspaceId}/ticket-statuses",
  },
  {
    operationId: "listQuillsTicketTypes",
    method: "GET",
    path: "/api/quills/{workspaceId}/ticket-types",
  },
  {
    operationId: "listQuillsTicketWatchers",
    method: "GET",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/watchers",
  },
  {
    operationId: "listQuillsUserAttributes",
    method: "GET",
    path: "/api/quills/{workspaceId}/user-attributes",
  },
  {
    operationId: "listQuillsUserDuplicates",
    method: "GET",
    path: "/api/quills/{workspaceId}/users/{principalId}/duplicates",
  },
  {
    operationId: "listQuillsUsers",
    method: "GET",
    path: "/api/quills/{workspaceId}/users",
  },
  {
    operationId: "listQuillsUserTags",
    method: "GET",
    path: "/api/quills/{workspaceId}/user-tags",
  },
  {
    operationId: "listQuillsUserTagsForPrincipal",
    method: "GET",
    path: "/api/quills/{workspaceId}/users/{principalId}/tags",
  },
  {
    operationId: "listQuillsWebhooks",
    method: "GET",
    path: "/api/quills/{workspaceId}/webhooks",
  },
  {
    operationId: "listQuillsWebSources",
    method: "GET",
    path: "/api/quills/{workspaceId}/assistant/web-sources",
  },
  {
    operationId: "listQuillsWidgetBoards",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/boards",
  },
  {
    operationId: "listQuillsWidgetChangelog",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/changelog",
  },
  {
    operationId: "listQuillsWidgetConversationMessages",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/conversations/{conversationId}/messages",
  },
  {
    operationId: "listQuillsWidgetConversations",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/conversations",
  },
  {
    operationId: "listQuillsWidgetHelpArticles",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/help/articles",
  },
  {
    operationId: "listQuillsWidgetHelpCategories",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/help/categories",
  },
  {
    operationId: "listQuillsWidgetPostComments",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/posts/{postId}/comments",
  },
  {
    operationId: "listQuillsWidgetPosts",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/posts",
  },
  {
    operationId: "listQuillsWidgetTeamAvatars",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/team-avatars",
  },
  {
    operationId: "listQuillsWidgetVotedPosts",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/voted-posts",
  },
  {
    operationId: "listQuillsWorkflowRunEvents",
    method: "GET",
    path: "/api/quills/{workspaceId}/automation/runs/{runId}/events",
  },
  {
    operationId: "listQuillsWorkflowRuns",
    method: "GET",
    path: "/api/quills/{workspaceId}/automation/workflows/{workflowId}/runs",
  },
  {
    operationId: "listQuillsWorkflows",
    method: "GET",
    path: "/api/quills/{workspaceId}/automation/workflows",
  },
  {
    operationId: "listQuillsWorkflowVersions",
    method: "GET",
    path: "/api/quills/{workspaceId}/automation/workflows/{workflowId}/versions",
  },
  {
    operationId: "lookupQuillsWebsiteBranding",
    method: "POST",
    path: "/api/quills/{workspaceId}/settings/website-branding/lookup",
  },
  {
    operationId: "markQuillsAllNotificationsRead",
    method: "POST",
    path: "/api/quills/{workspaceId}/notifications/read-all",
  },
  {
    operationId: "markQuillsConversationRead",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/read",
  },
  {
    operationId: "markQuillsConversationUnreadFromMessage",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/unread",
  },
  {
    operationId: "markQuillsMyConversationRead",
    method: "PUT",
    path: "/api/quills-public/{workspace}/support/conversations/{conversationId}/read",
  },
  {
    operationId: "markQuillsNotificationRead",
    method: "POST",
    path: "/api/quills/{workspaceId}/notifications/{notificationId}/read",
  },
  {
    operationId: "markQuillsTicketRead",
    method: "POST",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/read",
  },
  {
    operationId: "markQuillsTicketUnread",
    method: "POST",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/unread",
  },
  {
    operationId: "markQuillsWidgetConversationRead",
    method: "PUT",
    path: "/api/quills-public/{workspace}/widget/conversations/{conversationId}/read",
  },
  {
    operationId: "mergeQuillsLeadIntoUser",
    method: "POST",
    path: "/api/quills/{workspaceId}/users/{principalId}/merge",
  },
  {
    operationId: "mergeQuillsPost",
    method: "POST",
    path: "/api/quills/{workspaceId}/posts/{postId}/merge",
  },
  {
    operationId: "mintQuillsWidgetInstallCode",
    method: "POST",
    path: "/api/quills/{workspaceId}/settings/widget/install-code",
  },
  {
    operationId: "muteQuillsTicket",
    method: "PUT",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/mute",
  },
  {
    operationId: "openQuillsOAuthBridge",
    method: "GET",
    path: "/api/quills-public/signed/oauth/{type}/bridge",
  },
  {
    operationId: "pauseQuillsWorkflow",
    method: "POST",
    path: "/api/quills/{workspaceId}/automation/workflows/{workflowId}/pause",
  },
  {
    operationId: "pinQuillsConversationView",
    method: "PUT",
    path: "/api/quills/{workspaceId}/conversation-views/{viewId}/pin",
  },
  {
    operationId: "postQuillsStatusIncidentUpdate",
    method: "POST",
    path: "/api/quills/{workspaceId}/status/incidents/{incidentId}/updates",
  },
  {
    operationId: "prepareQuillsPortalUpload",
    method: "POST",
    path: "/api/quills-public/{workspace}/portal/uploads/prepare",
  },
  {
    operationId: "previewQuillsAttributeDetection",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversation-attributes/{attributeId}/detection-preview",
  },
  {
    operationId: "previewQuillsUnsubscribeToken",
    method: "GET",
    path: "/api/quills-public/{workspace}/unsubscribe",
  },
  {
    operationId: "previewQuillsWorkflow",
    method: "GET",
    path: "/api/quills/{workspaceId}/automation/workflows/{workflowId}/preview",
  },
  {
    operationId: "processQuillsUnsubscribeToken",
    method: "POST",
    path: "/api/quills-public/{workspace}/unsubscribe/confirm",
  },
  {
    operationId: "publishQuillsWorkflow",
    method: "POST",
    path: "/api/quills/{workspaceId}/automation/workflows/{workflowId}/publish",
  },
  {
    operationId: "readQuillsTogether",
    method: "POST",
    path: "/api/quills/{workspaceId}/read-batch",
  },
  {
    operationId: "receiveQuillsAppHook",
    method: "POST",
    path: "/api/quills-public/signed/integrations/{type}/{integrationId}/hooks/{kind}",
  },
  {
    operationId: "receiveQuillsEmailDeliveryEvent",
    method: "POST",
    path: "/api/quills-public/signed/chat/email/events",
  },
  {
    operationId: "receiveQuillsIdentify",
    method: "POST",
    path: "/api/quills-public/signed/integrations/{type}/{integrationId}/identify",
  },
  {
    operationId: "receiveQuillsInboundEmail",
    method: "POST",
    path: "/api/quills-public/signed/chat/email/inbound",
  },
  {
    operationId: "receiveQuillsIntegrationWebhook",
    method: "POST",
    path: "/api/quills-public/signed/integrations/{type}/{integrationId}/webhook",
  },
  {
    operationId: "recordQuillsCopilotEvent",
    method: "POST",
    path: "/api/quills/{workspaceId}/assistant/copilot-events",
  },
  {
    operationId: "recordQuillsCsatViaToken",
    method: "POST",
    path: "/api/quills-public/{workspace}/support/csat-email",
  },
  {
    operationId: "recordQuillsHelpCenterArticleFeedback",
    method: "POST",
    path: "/api/quills/{workspaceId}/help-center/articles/{articleId}/feedback",
  },
  {
    operationId: "recordQuillsPortalAccessDenied",
    method: "POST",
    path: "/api/quills-public/{workspace}/portal/access-denied",
  },
  {
    operationId: "recordQuillsPublicArticleFeedback",
    method: "POST",
    path: "/api/quills-public/{workspace}/hc/articles/{articleId}/feedback",
  },
  {
    operationId: "recoverQuillsIntegrationSync",
    method: "POST",
    path: "/api/quills/{workspaceId}/integration-syncs/{syncId}/actions",
  },
  {
    operationId: "redeemQuillsWidgetInstallCode",
    method: "POST",
    path: "/api/quills-public/{workspace}/widget/install-context",
  },
  {
    operationId: "refreshQuillsConnector",
    method: "POST",
    path: "/api/quills/{workspaceId}/assistant/connectors/{connectorId}/refresh",
  },
  {
    operationId: "registerQuillsPushDevice",
    method: "POST",
    path: "/api/quills/{workspaceId}/devices",
  },
  {
    operationId: "rejectQuillsAssistantAction",
    method: "POST",
    path: "/api/quills/{workspaceId}/assistant/pending-actions/{actionId}/reject",
  },
  {
    operationId: "rejectQuillsComment",
    method: "POST",
    path: "/api/quills/{workspaceId}/moderation/comments/{commentId}/reject",
  },
  {
    operationId: "rejectQuillsPost",
    method: "POST",
    path: "/api/quills/{workspaceId}/moderation/posts/{postId}/reject",
  },
  {
    operationId: "removeQuillsCommentPin",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/posts/{postId}/pinned-comment/{commentId}",
  },
  {
    operationId: "removeQuillsCommentReaction",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/comments/{commentId}/reactions",
  },
  {
    operationId: "removeQuillsConversationParticipant",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/participants/{principalId}",
  },
  {
    operationId: "removeQuillsConversationTag",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/tags/{tagId}",
  },
  {
    operationId: "removeQuillsHelpCenterDomain",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/operations/domains/help-center",
  },
  {
    operationId: "removeQuillsMessageFlag",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/conversation-messages/{messageId}/flag",
  },
  {
    operationId: "removeQuillsMessageReaction",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/conversation-messages/{messageId}/reactions",
  },
  {
    operationId: "removeQuillsNotificationChannel",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/integrations/{integrationId}/channels/{channel}",
  },
  {
    operationId: "removeQuillsPortalDomain",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/operations/domains/portal",
  },
  {
    operationId: "removeQuillsPostVote",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/posts/{postId}/voters/{principalId}",
  },
  {
    operationId: "removeQuillsSegmentMembers",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/segments/{segmentId}/members",
  },
  {
    operationId: "removeQuillsStatusSubscriber",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/status/subscribers/{principalId}",
  },
  {
    operationId: "removeQuillsTicketWatcher",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/watchers/{principalId}",
  },
  {
    operationId: "removeQuillsUserCompany",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/users/{principalId}/company",
  },
  {
    operationId: "removeQuillsUserTag",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/users/{principalId}/tags/{tagId}",
  },
  {
    operationId: "reorderQuillsChangelogCategories",
    method: "PUT",
    path: "/api/quills/{workspaceId}/changelog/categories/order",
  },
  {
    operationId: "reorderQuillsGuidanceRules",
    method: "PUT",
    path: "/api/quills/{workspaceId}/assistant/guidance-rules/order",
  },
  {
    operationId: "reorderQuillsHelpCenterArticles",
    method: "PUT",
    path: "/api/quills/{workspaceId}/help-center/categories/{categoryId}/articles/order",
  },
  {
    operationId: "reorderQuillsHelpCenterCategories",
    method: "PUT",
    path: "/api/quills/{workspaceId}/help-center/categories/order",
  },
  {
    operationId: "reorderQuillsRoadmaps",
    method: "PUT",
    path: "/api/quills/{workspaceId}/roadmaps/order",
  },
  {
    operationId: "reorderQuillsStatusComponents",
    method: "PUT",
    path: "/api/quills/{workspaceId}/status/components/order",
  },
  {
    operationId: "reorderQuillsStatuses",
    method: "PUT",
    path: "/api/quills/{workspaceId}/statuses/order",
  },
  {
    operationId: "reorderQuillsStatusGroups",
    method: "PUT",
    path: "/api/quills/{workspaceId}/status/groups/order",
  },
  {
    operationId: "reorderQuillsTicketStatuses",
    method: "PUT",
    path: "/api/quills/{workspaceId}/ticket-statuses/order",
  },
  {
    operationId: "reorderQuillsWorkflows",
    method: "PUT",
    path: "/api/quills/{workspaceId}/automation/workflows/order",
  },
  {
    operationId: "replyQuillsConversation",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/reply",
  },
  {
    operationId: "replyQuillsTicket",
    method: "POST",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/reply",
  },
  {
    operationId: "requestQuillsArticleTranslation",
    method: "POST",
    path: "/api/quills/{workspaceId}/help-center/articles/{articleId}/auto-translate",
  },
  {
    operationId: "requestQuillsConversationSummary",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/summary",
  },
  {
    operationId: "requestQuillsEmailChange",
    method: "POST",
    path: "/api/quills-public/{workspace}/widget/contact-email",
  },
  {
    operationId: "requestQuillsEmbeddingBackfill",
    method: "POST",
    path: "/api/quills/{workspaceId}/assistant/embeddings/backfill",
  },
  {
    operationId: "requestQuillsPostSentiment",
    method: "POST",
    path: "/api/quills/{workspaceId}/posts/{postId}/sentiment",
  },
  {
    operationId: "requestQuillsPostTagBackfill",
    method: "POST",
    path: "/api/quills/{workspaceId}/posts/ai-tags/backfill",
  },
  {
    operationId: "requestQuillsTicketSummary",
    method: "POST",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/summary",
  },
  {
    operationId: "resendQuillsPortalInvite",
    method: "POST",
    path: "/api/quills/{workspaceId}/portal/invites/{inviteId}/resend",
  },
  {
    operationId: "resolveQuillsPublicHelpCenterRedirect",
    method: "GET",
    path: "/api/quills-public/{workspace}/hc/redirect",
  },
  {
    operationId: "restartQuillsSendingDomainChecks",
    method: "POST",
    path: "/api/quills/{workspaceId}/support/email-channel/domains/{sendingDomainId}/checks",
  },
  {
    operationId: "restoreQuillsComment",
    method: "POST",
    path: "/api/quills/{workspaceId}/comments/{commentId}/restore",
  },
  {
    operationId: "restoreQuillsConversationAttribute",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversation-attributes/{attributeId}/restore",
  },
  {
    operationId: "restoreQuillsConversationFromSpam",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/restore-spam",
  },
  {
    operationId: "restoreQuillsConversationTag",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversation-tags/{tagId}/restore",
  },
  {
    operationId: "restoreQuillsHelpCenterArticle",
    method: "POST",
    path: "/api/quills/{workspaceId}/help-center/articles/{articleId}/restore",
  },
  {
    operationId: "restoreQuillsHelpCenterCategory",
    method: "POST",
    path: "/api/quills/{workspaceId}/help-center/categories/{categoryId}/restore",
  },
  {
    operationId: "restoreQuillsPost",
    method: "POST",
    path: "/api/quills/{workspaceId}/posts/{postId}/restore",
  },
  {
    operationId: "restoreQuillsSlaPolicy",
    method: "POST",
    path: "/api/quills/{workspaceId}/sla-policies/{slaPolicyId}/restore",
  },
  {
    operationId: "restoreQuillsSuggestion",
    method: "POST",
    path: "/api/quills/{workspaceId}/suggestions/{suggestionId}/restore",
  },
  {
    operationId: "restoreQuillsTicketType",
    method: "POST",
    path: "/api/quills/{workspaceId}/ticket-types/{ticketTypeId}/restore",
  },
  {
    operationId: "restoreQuillsWorkflowVersion",
    method: "POST",
    path: "/api/quills/{workspaceId}/automation/workflows/{workflowId}/versions/{versionId}/restore",
  },
  {
    operationId: "retryQuillsGitHubAgentMessage",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversation-messages/{messageId}/github-retry",
  },
  {
    operationId: "retryQuillsJob",
    method: "POST",
    path: "/api/quills/{workspaceId}/jobs/{jobId}/retry",
  },
  {
    operationId: "retryQuillsPostIntegrationSync",
    method: "POST",
    path: "/api/quills/{workspaceId}/posts/{postId}/integration-sync",
  },
  {
    operationId: "retryQuillsPostMergeCheck",
    method: "POST",
    path: "/api/quills/{workspaceId}/posts/{postId}/merge-check",
  },
  {
    operationId: "rotateQuillsWebhookSecret",
    method: "POST",
    path: "/api/quills/{workspaceId}/webhooks/{webhookId}/rotate",
  },
  {
    operationId: "rotateQuillsWidgetSecret",
    method: "POST",
    path: "/api/quills/{workspaceId}/settings/widget/secret",
  },
  {
    operationId: "runQuillsWorkflowManually",
    method: "POST",
    path: "/api/quills/{workspaceId}/automation/workflows/{workflowId}/run",
  },
  {
    operationId: "saveQuillsAzureDevopsKey",
    method: "PUT",
    path: "/api/quills/{workspaceId}/integrations/azure-devops/connection",
  },
  {
    operationId: "saveQuillsCustomerAvatar",
    method: "PUT",
    path: "/api/quills-public/{workspace}/user/avatar",
  },
  {
    operationId: "saveQuillsFaviconKey",
    method: "PUT",
    path: "/api/quills/{workspaceId}/settings/favicon",
  },
  {
    operationId: "saveQuillsFreshdeskKey",
    method: "PUT",
    path: "/api/quills/{workspaceId}/integrations/freshdesk/connection",
  },
  {
    operationId: "saveQuillsHeaderLogoKey",
    method: "PUT",
    path: "/api/quills/{workspaceId}/settings/header-logo",
  },
  {
    operationId: "saveQuillsHelpCenterArticleTranslation",
    method: "PUT",
    path: "/api/quills/{workspaceId}/help-center/articles/{articleId}/translations",
  },
  {
    operationId: "saveQuillsHelpCenterCategoryTranslation",
    method: "PUT",
    path: "/api/quills/{workspaceId}/help-center/categories/{categoryId}/translations",
  },
  {
    operationId: "saveQuillsLogoKey",
    method: "PUT",
    path: "/api/quills/{workspaceId}/settings/logo",
  },
  {
    operationId: "saveQuillsMakeWebhook",
    method: "PUT",
    path: "/api/quills/{workspaceId}/integrations/make/connection",
  },
  {
    operationId: "saveQuillsN8nWebhook",
    method: "PUT",
    path: "/api/quills/{workspaceId}/integrations/n8n/connection",
  },
  {
    operationId: "saveQuillsNtfy",
    method: "PUT",
    path: "/api/quills/{workspaceId}/integrations/ntfy/connection",
  },
  {
    operationId: "saveQuillsPlatformCredentials",
    method: "PUT",
    path: "/api/quills/{workspaceId}/integration-platform-credentials",
  },
  {
    operationId: "saveQuillsSegmentConnection",
    method: "PUT",
    path: "/api/quills/{workspaceId}/integrations/segment/connection",
  },
  {
    operationId: "saveQuillsShortcutToken",
    method: "PUT",
    path: "/api/quills/{workspaceId}/integrations/shortcut/connection",
  },
  {
    operationId: "saveQuillsStripeKey",
    method: "PUT",
    path: "/api/quills/{workspaceId}/integrations/stripe/connection",
  },
  {
    operationId: "saveQuillsWidgetHeroImageKey",
    method: "PUT",
    path: "/api/quills/{workspaceId}/settings/widget/hero-image",
  },
  {
    operationId: "saveQuillsZapierWebhook",
    method: "PUT",
    path: "/api/quills/{workspaceId}/integrations/zapier/connection",
  },
  {
    operationId: "searchQuillsAppPosts",
    method: "GET",
    path: "/api/quills/{workspaceId}/apps/search",
  },
  {
    operationId: "searchQuillsExternalItems",
    method: "GET",
    path: "/api/quills/{workspaceId}/integrations/{integrationId}/external-items",
  },
  {
    operationId: "searchQuillsHelpCenterSemantic",
    method: "POST",
    path: "/api/quills/{workspaceId}/help-center/semantic-search",
  },
  {
    operationId: "searchQuillsIntegrationContact",
    method: "GET",
    path: "/api/quills/{workspaceId}/integrations/{integrationId}/contacts",
  },
  {
    operationId: "searchQuillsPublicHelpCenter",
    method: "POST",
    path: "/api/quills-public/{workspace}/hc/search",
  },
  {
    operationId: "searchQuillsShippedPosts",
    method: "GET",
    path: "/api/quills/{workspaceId}/changelog/shipped-posts",
  },
  {
    operationId: "searchQuillsWidgetHelp",
    method: "POST",
    path: "/api/quills-public/{workspace}/widget/kb-search",
  },
  {
    operationId: "searchQuillsWorkspace",
    method: "GET",
    path: "/api/quills/{workspaceId}/search",
  },
  {
    operationId: "sendQuillsAgentHeartbeat",
    method: "PUT",
    path: "/api/quills/{workspaceId}/support/presence",
  },
  {
    operationId: "sendQuillsConversationTyping",
    method: "PUT",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/typing",
  },
  {
    operationId: "sendQuillsCurrentAddressCode",
    method: "POST",
    path: "/api/quills-public/{workspace}/widget/contact-email/current-code",
  },
  {
    operationId: "sendQuillsMyConversationMessage",
    method: "POST",
    path: "/api/quills-public/{workspace}/support/conversations/{conversationId}/messages",
  },
  {
    operationId: "sendQuillsMyConversationTyping",
    method: "POST",
    path: "/api/quills-public/{workspace}/support/conversations/{conversationId}/typing",
  },
  {
    operationId: "sendQuillsPortalInvite",
    method: "POST",
    path: "/api/quills/{workspaceId}/portal/invites",
  },
  {
    operationId: "sendQuillsWidgetConversationMessage",
    method: "POST",
    path: "/api/quills-public/{workspace}/widget/conversations/{conversationId}/messages",
  },
  {
    operationId: "sendQuillsWidgetConversationTyping",
    method: "POST",
    path: "/api/quills-public/{workspace}/widget/conversations/{conversationId}/typing",
  },
  {
    operationId: "setQuillsAgentAvailability",
    method: "PUT",
    path: "/api/quills/{workspaceId}/support/availability",
  },
  {
    operationId: "setQuillsChangelogSubscriber",
    method: "PUT",
    path: "/api/quills/{workspaceId}/changelog-subscribers/{principalId}",
  },
  {
    operationId: "setQuillsCommentPin",
    method: "PUT",
    path: "/api/quills/{workspaceId}/posts/{postId}/pinned-comment/{commentId}",
  },
  {
    operationId: "setQuillsCommentReaction",
    method: "PUT",
    path: "/api/quills/{workspaceId}/comments/{commentId}/reactions",
  },
  {
    operationId: "setQuillsConversationAttributeValue",
    method: "PUT",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/attributes/{key}",
  },
  {
    operationId: "setQuillsConversationPriority",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/priority",
  },
  {
    operationId: "setQuillsConversationRouting",
    method: "PUT",
    path: "/api/quills/{workspaceId}/support/routing",
  },
  {
    operationId: "setQuillsConversationStatus",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/status",
  },
  {
    operationId: "setQuillsDefaultSlaPolicy",
    method: "PUT",
    path: "/api/quills/{workspaceId}/support/default-sla-policy",
  },
  {
    operationId: "setQuillsEmailAutoAck",
    method: "PUT",
    path: "/api/quills/{workspaceId}/support/email-auto-ack",
  },
  {
    operationId: "setQuillsGitHubInboxEnabled",
    method: "PUT",
    path: "/api/quills/{workspaceId}/channels/github/inbox",
  },
  {
    operationId: "setQuillsHelpCenterArticleTranslationStatus",
    method: "PUT",
    path: "/api/quills/{workspaceId}/help-center/articles/{articleId}/translations/status",
  },
  {
    operationId: "setQuillsHelpCenterDomain",
    method: "PUT",
    path: "/api/quills/{workspaceId}/operations/domains/help-center",
  },
  {
    operationId: "setQuillsInboundForwarding",
    method: "PUT",
    path: "/api/quills/{workspaceId}/support/email-channel/inbound",
  },
  {
    operationId: "setQuillsInboundTrust",
    method: "PUT",
    path: "/api/quills/{workspaceId}/support/email-channel/inbound/trust",
  },
  {
    operationId: "setQuillsInboxTranslationEnabled",
    method: "PUT",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/translation",
  },
  {
    operationId: "setQuillsMessageFlag",
    method: "PUT",
    path: "/api/quills/{workspaceId}/conversation-messages/{messageId}/flag",
  },
  {
    operationId: "setQuillsMessageReaction",
    method: "PUT",
    path: "/api/quills/{workspaceId}/conversation-messages/{messageId}/reactions",
  },
  {
    operationId: "setQuillsModerationDefault",
    method: "PUT",
    path: "/api/quills/{workspaceId}/moderation/default",
  },
  {
    operationId: "setQuillsMyLanguagePreference",
    method: "PUT",
    path: "/api/quills-public/{workspace}/user/language",
  },
  {
    operationId: "setQuillsMyPostSubscription",
    method: "PUT",
    path: "/api/quills-public/{workspace}/posts/{postId}/subscription",
  },
  {
    operationId: "setQuillsOfficeHours",
    method: "PUT",
    path: "/api/quills/{workspaceId}/support/office-hours",
  },
  {
    operationId: "setQuillsPortalCommentReaction",
    method: "PUT",
    path: "/api/quills-public/{workspace}/portal/comments/{commentId}/reactions",
  },
  {
    operationId: "setQuillsPortalDomain",
    method: "PUT",
    path: "/api/quills/{workspaceId}/operations/domains/portal",
  },
  {
    operationId: "setQuillsPortalFollow",
    method: "PUT",
    path: "/api/quills-public/{workspace}/portal/posts/{postId}/follow",
  },
  {
    operationId: "setQuillsPortalVote",
    method: "PUT",
    path: "/api/quills-public/{workspace}/portal/posts/{postId}/vote",
  },
  {
    operationId: "setQuillsPostBoard",
    method: "PUT",
    path: "/api/quills/{workspaceId}/posts/{postId}/board",
  },
  {
    operationId: "setQuillsPostOwner",
    method: "PUT",
    path: "/api/quills/{workspaceId}/posts/{postId}/owner",
  },
  {
    operationId: "setQuillsPostStatus",
    method: "PUT",
    path: "/api/quills/{workspaceId}/posts/{postId}/status",
  },
  {
    operationId: "setQuillsPostSubscription",
    method: "PUT",
    path: "/api/quills/{workspaceId}/posts/{postId}/subscription",
  },
  {
    operationId: "setQuillsPostTags",
    method: "PUT",
    path: "/api/quills/{workspaceId}/posts/{postId}/tags",
  },
  {
    operationId: "setQuillsPoweredBy",
    method: "PUT",
    path: "/api/quills/{workspaceId}/operations/powered-by",
  },
  {
    operationId: "setQuillsSendingAddressSmtp",
    method: "PUT",
    path: "/api/quills/{workspaceId}/support/email-channel/sending-addresses/{channelAccountId}/smtp",
  },
  {
    operationId: "setQuillsSlackAssistantEnabled",
    method: "PUT",
    path: "/api/quills/{workspaceId}/assistant/slack",
  },
  {
    operationId: "setQuillsSurveyStatus",
    method: "PUT",
    path: "/api/quills/{workspaceId}/surveys/{surveyId}/status",
  },
  {
    operationId: "setQuillsTicketPriority",
    method: "POST",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/priority",
  },
  {
    operationId: "setQuillsTicketStageLabels",
    method: "PUT",
    path: "/api/quills/{workspaceId}/ticket-stage-labels",
  },
  {
    operationId: "setQuillsTicketStatus",
    method: "POST",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/status",
  },
  {
    operationId: "setQuillsUserCompany",
    method: "PUT",
    path: "/api/quills/{workspaceId}/users/{principalId}/company",
  },
  {
    operationId: "setQuillsVoterSubscription",
    method: "PUT",
    path: "/api/quills/{workspaceId}/posts/{postId}/subscribers/{principalId}",
  },
  {
    operationId: "setQuillsWebSourceEnabled",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/assistant/web-sources/{webSourceId}",
  },
  {
    operationId: "setQuillsWidgetCommentReaction",
    method: "PUT",
    path: "/api/quills-public/{workspace}/widget/comments/{commentId}/reactions",
  },
  {
    operationId: "setQuillsWidgetFollow",
    method: "PUT",
    path: "/api/quills-public/{workspace}/widget/posts/{postId}/follow",
  },
  {
    operationId: "setQuillsWidgetHelpArticleFeedback",
    method: "PUT",
    path: "/api/quills-public/{workspace}/widget/help/articles/{articleId}/feedback",
  },
  {
    operationId: "setQuillsWidgetVote",
    method: "PUT",
    path: "/api/quills-public/{workspace}/widget/posts/{postId}/vote",
  },
  {
    operationId: "setQuillsWorkflowAbandonedAutoClose",
    method: "PUT",
    path: "/api/quills/{workspaceId}/automation/settings/abandoned-auto-close",
  },
  {
    operationId: "setQuillsWorkflowCloseSpam",
    method: "PUT",
    path: "/api/quills/{workspaceId}/automation/settings/close-spam",
  },
  {
    operationId: "shareQuillsPost",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/share-post",
  },
  {
    operationId: "snoozeQuillsConversation",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/snooze",
  },
  {
    operationId: "startQuillsAgentConversation",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversations",
  },
  {
    operationId: "startQuillsAsanaOAuthConnect",
    method: "GET",
    path: "/api/quills/{workspaceId}/oauth/asana/connect",
  },
  {
    operationId: "startQuillsAutomaticWebsiteBranding",
    method: "POST",
    path: "/api/quills/{workspaceId}/settings/website-branding/start",
  },
  {
    operationId: "startQuillsClickupOAuthConnect",
    method: "GET",
    path: "/api/quills/{workspaceId}/oauth/clickup/connect",
  },
  {
    operationId: "startQuillsConnectorOAuth",
    method: "POST",
    path: "/api/quills/{workspaceId}/assistant/connectors/{connectorId}/oauth",
  },
  {
    operationId: "startQuillsDiscordOAuthConnect",
    method: "GET",
    path: "/api/quills/{workspaceId}/oauth/discord/connect",
  },
  {
    operationId: "startQuillsGithubOAuthConnect",
    method: "GET",
    path: "/api/quills/{workspaceId}/oauth/github/connect",
  },
  {
    operationId: "startQuillsGitlabOAuthConnect",
    method: "GET",
    path: "/api/quills/{workspaceId}/oauth/gitlab/connect",
  },
  {
    operationId: "startQuillsHubspotOAuthConnect",
    method: "GET",
    path: "/api/quills/{workspaceId}/oauth/hubspot/connect",
  },
  {
    operationId: "startQuillsIntercomOAuthConnect",
    method: "GET",
    path: "/api/quills/{workspaceId}/oauth/intercom/connect",
  },
  {
    operationId: "startQuillsJiraOAuthConnect",
    method: "GET",
    path: "/api/quills/{workspaceId}/oauth/jira/connect",
  },
  {
    operationId: "startQuillsLinearOAuthConnect",
    method: "GET",
    path: "/api/quills/{workspaceId}/oauth/linear/connect",
  },
  {
    operationId: "startQuillsMondayOAuthConnect",
    method: "GET",
    path: "/api/quills/{workspaceId}/oauth/monday/connect",
  },
  {
    operationId: "startQuillsMyConversation",
    method: "POST",
    path: "/api/quills-public/{workspace}/support/conversations",
  },
  {
    operationId: "startQuillsNotionOAuthConnect",
    method: "GET",
    path: "/api/quills/{workspaceId}/oauth/notion/connect",
  },
  {
    operationId: "startQuillsSalesforceOAuthConnect",
    method: "GET",
    path: "/api/quills/{workspaceId}/oauth/salesforce/connect",
  },
  {
    operationId: "startQuillsSlackOAuthConnect",
    method: "GET",
    path: "/api/quills/{workspaceId}/oauth/slack/connect",
  },
  {
    operationId: "startQuillsStatusMaintenance",
    method: "POST",
    path: "/api/quills/{workspaceId}/status/incidents/{incidentId}/start",
  },
  {
    operationId: "startQuillsTeamsOAuthConnect",
    method: "GET",
    path: "/api/quills/{workspaceId}/oauth/teams/connect",
  },
  {
    operationId: "startQuillsTrelloOAuthConnect",
    method: "GET",
    path: "/api/quills/{workspaceId}/oauth/trello/connect",
  },
  {
    operationId: "startQuillsWidgetConversation",
    method: "POST",
    path: "/api/quills-public/{workspace}/widget/conversations",
  },
  {
    operationId: "startQuillsZendeskOAuthConnect",
    method: "GET",
    path: "/api/quills/{workspaceId}/oauth/zendesk/connect",
  },
  {
    operationId: "submitQuillsCsat",
    method: "POST",
    path: "/api/quills-public/{workspace}/support/conversations/{conversationId}/csat",
  },
  {
    operationId: "submitQuillsPortalSurveyResponse",
    method: "POST",
    path: "/api/quills-public/{workspace}/portal/surveys/{surveyId}/responses",
  },
  {
    operationId: "submitQuillsPublicArticleFeedbackReason",
    method: "POST",
    path: "/api/quills-public/{workspace}/hc/feedback/{feedbackId}/reason",
  },
  {
    operationId: "submitQuillsWidgetCsat",
    method: "POST",
    path: "/api/quills-public/{workspace}/widget/conversations/{conversationId}/csat",
  },
  {
    operationId: "submitQuillsWidgetSurveyResponse",
    method: "POST",
    path: "/api/quills-public/{workspace}/widget/surveys/{surveyId}/responses",
  },
  {
    operationId: "subscribeQuillsMyChangelog",
    method: "PUT",
    path: "/api/quills-public/{workspace}/changelog/subscription",
  },
  {
    operationId: "subscribeQuillsStatus",
    method: "PUT",
    path: "/api/quills-public/{workspace}/status/subscription",
  },
  {
    operationId: "suggestQuillsAppPosts",
    method: "GET",
    path: "/api/quills/{workspaceId}/apps/suggest",
  },
  {
    operationId: "suggestQuillsTicketFieldValues",
    method: "POST",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/field-suggestions",
  },
  {
    operationId: "translateQuillsConversationMessages",
    method: "POST",
    path: "/api/quills/{workspaceId}/conversations/{conversationId}/messages/{messageId}/translate",
  },
  {
    operationId: "unblockQuillsUser",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/users/{principalId}/block",
  },
  {
    operationId: "undoQuillsAutomaticWebsiteBranding",
    method: "POST",
    path: "/api/quills/{workspaceId}/settings/website-branding/undo",
  },
  {
    operationId: "unfurlQuillsLink",
    method: "GET",
    path: "/api/quills/{workspaceId}/support/link-preview",
  },
  {
    operationId: "unfurlQuillsPortalLink",
    method: "GET",
    path: "/api/quills-public/{workspace}/support/link-preview",
  },
  {
    operationId: "unfurlQuillsWidgetLink",
    method: "GET",
    path: "/api/quills-public/{workspace}/widget/link-preview",
  },
  {
    operationId: "unlinkQuillsAppPost",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/apps/links",
  },
  {
    operationId: "unlinkQuillsBoardFromProject",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/boards/{boardId}/projects/{projectId}",
  },
  {
    operationId: "unlinkQuillsCustomerProfile",
    method: "DELETE",
    path: "/api/quills-public/{workspace}/user/profile",
  },
  {
    operationId: "unlinkQuillsPostFromTask",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/posts/{postId}/tasks/{taskId}",
  },
  {
    operationId: "unlinkQuillsTicketFromTracker",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/tracker/{trackerTicketId}",
  },
  {
    operationId: "unlinkQuillsTicketIssue",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/external-links/{linkId}",
  },
  {
    operationId: "unmergeQuillsPost",
    method: "POST",
    path: "/api/quills/{workspaceId}/posts/{postId}/unmerge",
  },
  {
    operationId: "unmuteQuillsTicket",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/mute",
  },
  {
    operationId: "unpinQuillsConversationView",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/conversation-views/{viewId}/pin",
  },
  {
    operationId: "unregisterQuillsPushDevice",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/devices",
  },
  {
    operationId: "unsubscribeQuillsMyChangelog",
    method: "DELETE",
    path: "/api/quills-public/{workspace}/changelog/subscription",
  },
  {
    operationId: "unsubscribeQuillsStatus",
    method: "DELETE",
    path: "/api/quills-public/{workspace}/status/subscription",
  },
  {
    operationId: "unsubscribeQuillsStatusByToken",
    method: "POST",
    path: "/api/quills-public/{workspace}/status/unsubscribe",
  },
  {
    operationId: "unwatchQuillsMyTicket",
    method: "DELETE",
    path: "/api/quills-public/{workspace}/support/tickets/{ticketId}/watch",
  },
  {
    operationId: "unwatchQuillsTicket",
    method: "DELETE",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/watch",
  },
  {
    operationId: "unwatchQuillsWidgetMyTicket",
    method: "DELETE",
    path: "/api/quills-public/{workspace}/widget/tickets/{ticketId}/watch",
  },
  {
    operationId: "updateQuillsAppRegistration",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/app-registrations/{appId}",
  },
  {
    operationId: "updateQuillsAssistantSettings",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/assistant/settings",
  },
  {
    operationId: "updateQuillsBoard",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/boards/{boardId}",
  },
  {
    operationId: "updateQuillsBrandingSettings",
    method: "PUT",
    path: "/api/quills/{workspaceId}/settings/branding",
  },
  {
    operationId: "updateQuillsChangelogCategory",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/changelog/categories/{categoryId}",
  },
  {
    operationId: "updateQuillsChangelogEntry",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/changelog/{entryId}",
  },
  {
    operationId: "updateQuillsChangelogSettings",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/changelog/settings",
  },
  {
    operationId: "updateQuillsComment",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/comments/{commentId}",
  },
  {
    operationId: "updateQuillsCompany",
    method: "PUT",
    path: "/api/quills/{workspaceId}/companies/{companyId}",
  },
  {
    operationId: "updateQuillsCompanyAttribute",
    method: "PUT",
    path: "/api/quills/{workspaceId}/company-attributes/{attributeId}",
  },
  {
    operationId: "updateQuillsConnector",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/assistant/connectors/{connectorId}",
  },
  {
    operationId: "updateQuillsConversationAttribute",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/conversation-attributes/{attributeId}",
  },
  {
    operationId: "updateQuillsConversationMessage",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/conversation-messages/{messageId}",
  },
  {
    operationId: "updateQuillsConversationTag",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/conversation-tags/{tagId}",
  },
  {
    operationId: "updateQuillsConversationView",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/conversation-views/{viewId}",
  },
  {
    operationId: "updateQuillsCustomerProfile",
    method: "PUT",
    path: "/api/quills-public/{workspace}/user/profile",
  },
  {
    operationId: "updateQuillsDeveloperSettings",
    method: "PUT",
    path: "/api/quills/{workspaceId}/settings/developer",
  },
  {
    operationId: "updateQuillsFeatureFlagSettings",
    method: "PUT",
    path: "/api/quills/{workspaceId}/settings/labs",
  },
  {
    operationId: "updateQuillsGuidanceRule",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/assistant/guidance-rules/{ruleId}",
  },
  {
    operationId: "updateQuillsHelpCenterArticle",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/help-center/articles/{articleId}",
  },
  {
    operationId: "updateQuillsHelpCenterCategory",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/help-center/categories/{categoryId}",
  },
  {
    operationId: "updateQuillsHelpCenterLocaleChrome",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/help-center/settings/locales",
  },
  {
    operationId: "updateQuillsHelpCenterSettings",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/help-center/settings",
  },
  {
    operationId: "updateQuillsIntegration",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/integrations/{integrationId}",
  },
  {
    operationId: "updateQuillsMacro",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/macros/{macroId}",
  },
  {
    operationId: "updateQuillsNotificationChannel",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/integrations/{integrationId}/channels/{channel}",
  },
  {
    operationId: "updateQuillsNotificationPreferences",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/notification-preferences",
  },
  {
    operationId: "updateQuillsPortalAccess",
    method: "PUT",
    path: "/api/quills/{workspaceId}/settings/portal/access",
  },
  {
    operationId: "updateQuillsPortalSettings",
    method: "PUT",
    path: "/api/quills/{workspaceId}/settings/portal",
  },
  {
    operationId: "updateQuillsPost",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/posts/{postId}",
  },
  {
    operationId: "updateQuillsRoadmap",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/roadmaps/{roadmapId}",
  },
  {
    operationId: "updateQuillsRoadmapColumn",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/roadmaps/{roadmapId}/columns/{columnId}",
  },
  {
    operationId: "updateQuillsSegment",
    method: "PUT",
    path: "/api/quills/{workspaceId}/segments/{segmentId}",
  },
  {
    operationId: "updateQuillsSkill",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/assistant/skills/{skillId}",
  },
  {
    operationId: "updateQuillsSlaPolicy",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/sla-policies/{slaPolicyId}",
  },
  {
    operationId: "updateQuillsSnippet",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/assistant/snippets/{snippetId}",
  },
  {
    operationId: "updateQuillsSpamFilterConfig",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/support/spam-filter",
  },
  {
    operationId: "updateQuillsStatus",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/statuses/{statusId}",
  },
  {
    operationId: "updateQuillsStatusComponent",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/status/components/{componentId}",
  },
  {
    operationId: "updateQuillsStatusGroup",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/status/groups/{groupId}",
  },
  {
    operationId: "updateQuillsStatusIncident",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/status/incidents/{incidentId}",
  },
  {
    operationId: "updateQuillsStatusMappings",
    method: "PUT",
    path: "/api/quills/{workspaceId}/integrations/{integrationId}/status-mappings",
  },
  {
    operationId: "updateQuillsStatusSettings",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/status/settings",
  },
  {
    operationId: "updateQuillsStatusTemplate",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/status/templates/{templateId}",
  },
  {
    operationId: "updateQuillsSurvey",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/surveys/{surveyId}",
  },
  {
    operationId: "updateQuillsTag",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/tags/{tagId}",
  },
  {
    operationId: "updateQuillsTeam",
    method: "PUT",
    path: "/api/quills/{workspaceId}/teams/{teamId}",
  },
  {
    operationId: "updateQuillsTeamBinding",
    method: "PUT",
    path: "/api/quills/{workspaceId}/teams/{teamId}/binding",
  },
  {
    operationId: "updateQuillsTicketStatus",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/ticket-statuses/{statusId}",
  },
  {
    operationId: "updateQuillsTicketType",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/ticket-types/{ticketTypeId}",
  },
  {
    operationId: "updateQuillsUser",
    method: "PUT",
    path: "/api/quills/{workspaceId}/users/{principalId}",
  },
  {
    operationId: "updateQuillsUserAttribute",
    method: "PUT",
    path: "/api/quills/{workspaceId}/user-attributes/{attributeId}",
  },
  {
    operationId: "updateQuillsWebhook",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/webhooks/{webhookId}",
  },
  {
    operationId: "updateQuillsWidgetSettings",
    method: "PUT",
    path: "/api/quills/{workspaceId}/settings/widget",
  },
  {
    operationId: "updateQuillsWorkflow",
    method: "PATCH",
    path: "/api/quills/{workspaceId}/automation/workflows/{workflowId}",
  },
  {
    operationId: "uploadQuillsAssistantDocument",
    method: "POST",
    path: "/api/quills/{workspaceId}/assistant/documents",
  },
  {
    operationId: "validateQuillsCsatEmailToken",
    method: "GET",
    path: "/api/quills-public/{workspace}/support/csat-email",
  },
  {
    operationId: "verifyQuillsHelpCenterDomain",
    method: "POST",
    path: "/api/quills/{workspaceId}/operations/domains/help-center/verify",
  },
  {
    operationId: "verifyQuillsPortalDomain",
    method: "POST",
    path: "/api/quills/{workspaceId}/operations/domains/portal/verify",
  },
  {
    operationId: "voteQuillsPost",
    method: "PUT",
    path: "/api/quills/{workspaceId}/posts/{postId}/vote",
  },
  {
    operationId: "watchQuillsMyTicket",
    method: "PUT",
    path: "/api/quills-public/{workspace}/support/tickets/{ticketId}/watch",
  },
  {
    operationId: "watchQuillsTicket",
    method: "PUT",
    path: "/api/quills/{workspaceId}/tickets/{ticketId}/watch",
  },
  {
    operationId: "watchQuillsWidgetMyTicket",
    method: "PUT",
    path: "/api/quills-public/{workspace}/widget/tickets/{ticketId}/watch",
  },
  {
    operationId: "wipeQuillsWorkspaceData",
    method: "POST",
    path: "/api/quills/{workspaceId}/operations/wipe",
  },
] as const;
