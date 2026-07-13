export type SourceInput = {
    chat_id: string
    domain: string
    source_type: 'EDITORIAL' | 'CORPORATE' | 'UGC' | 'SOCIAL' | 'COMPETITOR' | 'YOU' | 'REFERENCE' | 'INSTITUTIONAL' | 'OTHER'
    url: string
    is_cited: boolean
}