export type PromiseContentType<T> = T extends Promise<infer U> ? U : T
