/**
 * Literal Stage A quest-only bytes captured from
 * b0bd8cd25b3ae96cb88667ce72832d4c35eed7a1 before B1 changed A-prime's
 * versioned container. Nothing in this file derives an expectation from B1.
 */
export const ATTENTION_STAGE_A_QUEST_ONLY_BASELINE_COMMIT =
  'b0bd8cd25b3ae96cb88667ce72832d4c35eed7a1' as const

export const ATTENTION_STAGE_A_QUEST_ONLY_GOLDEN = Object.freeze({
  completeCanonicalQuestViewBytes: Object.freeze([
    '{"accessorContractVersion":"attention-quest-candidate-accessor-v1","candidateId":"quest-public-open","legallyVisibleOriginConsequenceReference":"consequence-public-37","legallyVisibleParties":["player","warden"],"legallyVisiblePublicStakes":"restore-public-trust","openingProvenanceId":"consequence-public-37","rankingSnapshotLsn":41}',
  ]),
  questViewIdentityBytes: '["quest-public-open"]',
  single: Object.freeze({
    completeCanonicalQuestViewBytes: Object.freeze([
      '{"accessorContractVersion":"attention-quest-candidate-accessor-v1","candidateId":"quest-p2-only","legallyVisibleParties":["player"],"legallyVisiblePublicStakes":"restore-public-trust","openingProvenanceId":"consequence-public-30","rankingSnapshotLsn":41}',
    ]),
    questViewIdentityBytes: '["quest-p2-only"]',
    normalizedCandidateIdsBytes:
      '["attention-candidate-identity-schema-v1:fnv1a64-v1:aaa4a562fc2aee1e"]',
    orderedCandidateIdsBytes:
      '["attention-candidate-identity-schema-v1:fnv1a64-v1:aaa4a562fc2aee1e"]',
    revealPackageBytes:
      '{"candidateId":"attention-candidate-identity-schema-v1:fnv1a64-v1:aaa4a562fc2aee1e","resultTag":"presentation-ready","slots":[{"slotId":"opening-provenance-id","values":["consequence-public-30"]},{"slotId":"legally-visible-parties","values":["player"]},{"slotId":"legally-visible-public-stakes","values":["restore-public-trust"]}],"templateVersion":"attention-extradiegetic-template-v1"}',
    renderedTemplateBytes:
      '{"lines":["attention-reveal/attention-extradiegetic-template-v1","candidate/attention-candidate-identity-schema-v1:fnv1a64-v1:aaa4a562fc2aee1e","opening-provenance/consequence-public-30","parties/player","public-stakes/restore-public-trust"],"output":"attention-reveal/attention-extradiegetic-template-v1\\ncandidate/attention-candidate-identity-schema-v1:fnv1a64-v1:aaa4a562fc2aee1e\\nopening-provenance/consequence-public-30\\nparties/player\\npublic-stakes/restore-public-trust"}',
    renderedOutputIdentity:
      'attention-extradiegetic-template-v1:fnv1a64-v1:50c71350d7cb639d',
    ledgerRecordsBytes:
      '[{"accessorContractVersion":"attention-quest-candidate-accessor-v1","candidateId":"attention-candidate-identity-schema-v1:fnv1a64-v1:aaa4a562fc2aee1e","canonicalizationVersion":"attention-candidate-canonicalization-v1","exposurePolicyVersion":"attention-exposure-policy-v1","ledgerPolicyVersion":"attention-ledger-policy-v1","outcome":"presentation-ready","rankingSnapshotLsn":41,"recordId":"attention-ledger-policy-v1:fnv1a64-v1:a2edf23a3168a125","renderedOutputIdentity":"attention-extradiegetic-template-v1:fnv1a64-v1:50c71350d7cb639d","sequence":0,"sourceId":"quest-p2-only","sourceKind":"quest_candidate","templateChannelPolicyVersion":"attention-template-channel-policy-v1","templateVersion":"attention-extradiegetic-template-v1"}]',
    ledgerFeaturesBytes:
      '{"exposureCount":1,"lastPresentedRankingSnapshotLsn":41,"nonEngagementCount":0,"repetitionCount":0}',
    playerObservableTraceBytes:
      '{"orderedCandidateIds":["attention-candidate-identity-schema-v1:fnv1a64-v1:aaa4a562fc2aee1e"],"presentations":[{"candidateId":"attention-candidate-identity-schema-v1:fnv1a64-v1:aaa4a562fc2aee1e","output":"attention-reveal/attention-extradiegetic-template-v1\\ncandidate/attention-candidate-identity-schema-v1:fnv1a64-v1:aaa4a562fc2aee1e\\nopening-provenance/consequence-public-30\\nparties/player\\npublic-stakes/restore-public-trust","resultTag":"presentation-ready"}],"rankingSnapshotLsn":41,"revalidationSnapshotLsn":41,"revalidations":[{"candidateId":"attention-candidate-identity-schema-v1:fnv1a64-v1:aaa4a562fc2aee1e","outcome":"still-legal"}]}',
  }),
  two: Object.freeze({
    completeCanonicalQuestViewBytes: Object.freeze([
      '{"accessorContractVersion":"attention-quest-candidate-accessor-v1","candidateId":"quest-pair-visible-a","legallyVisibleParties":["player","magistrate"],"legallyVisiblePublicStakes":"restore-public-trust","openingProvenanceId":"consequence-public-20","rankingSnapshotLsn":41}',
      '{"accessorContractVersion":"attention-quest-candidate-accessor-v1","candidateId":"quest-pair-visible-b","legallyVisibleOriginConsequenceReference":"consequence-declassified-22","legallyVisibleParties":["player","guildmaster"],"openingProvenanceId":"declassification-22","rankingSnapshotLsn":41}',
    ]),
    questViewIdentityBytes:
      '["quest-pair-visible-a","quest-pair-visible-b"]',
    normalizedCandidateIdsBytes:
      '["attention-candidate-identity-schema-v1:fnv1a64-v1:592d1283c02bee5d","attention-candidate-identity-schema-v1:fnv1a64-v1:1ed826011027be9e"]',
    orderedCandidateIdsBytes:
      '["attention-candidate-identity-schema-v1:fnv1a64-v1:592d1283c02bee5d","attention-candidate-identity-schema-v1:fnv1a64-v1:1ed826011027be9e"]',
  }),
  hidden: Object.freeze({
    questViewIdentityBytes:
      '["quest-pair-visible-a","quest-pair-visible-b"]',
    playerObservableTraceBytes:
      '{"orderedCandidateIds":["attention-candidate-identity-schema-v1:fnv1a64-v1:592d1283c02bee5d","attention-candidate-identity-schema-v1:fnv1a64-v1:1ed826011027be9e"],"presentations":[{"candidateId":"attention-candidate-identity-schema-v1:fnv1a64-v1:592d1283c02bee5d","output":"attention-reveal/attention-extradiegetic-template-v1\\ncandidate/attention-candidate-identity-schema-v1:fnv1a64-v1:592d1283c02bee5d\\nopening-provenance/consequence-public-20\\nparties/magistrate|player\\npublic-stakes/restore-public-trust","resultTag":"presentation-ready"},{"candidateId":"attention-candidate-identity-schema-v1:fnv1a64-v1:1ed826011027be9e","output":"attention-reveal/attention-extradiegetic-template-v1\\ncandidate/attention-candidate-identity-schema-v1:fnv1a64-v1:1ed826011027be9e\\nopening-provenance/declassification-22\\nparties/guildmaster|player\\norigin-consequence/consequence-declassified-22","resultTag":"presentation-ready"}],"rankingSnapshotLsn":41,"revalidationSnapshotLsn":41,"revalidations":[{"candidateId":"attention-candidate-identity-schema-v1:fnv1a64-v1:592d1283c02bee5d","outcome":"still-legal"},{"candidateId":"attention-candidate-identity-schema-v1:fnv1a64-v1:1ed826011027be9e","outcome":"still-legal"}]}',
  }),
  authoritativeCommittedLogBytes:
    '{"commits":[{"allocatedId":1,"commandId":"authoritative-command-1","commitSeq":0,"reducerCacheDigestAtCommit":"fnv1a64-v1:08f44b07b5901a25","rngValue":1282168119,"schedulerToken":0,"wallClockInputAtCommit":1000},{"allocatedId":2,"commandId":"authoritative-command-2","commitSeq":1,"reducerCacheDigestAtCommit":"fnv1a64-v1:08f44b07b5901a25","rngValue":317105069,"schedulerToken":1,"wallClockInputAtCommit":1001}]}',
  authoritativeCommittedLogDigest: 'fnv1a64-v1:c01d1110fc659825',
  zeroModelCount: 0,
})
