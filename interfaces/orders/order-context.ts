/**
 * We need to know some info about orders when (read: before) they are executed
 * i.e. when a position is first entered we want to know which edge it should be stored as
 */
 export interface OrderContext_V1 {
  object_type: "OrderContext"
  version: 1
  edge: string
}
