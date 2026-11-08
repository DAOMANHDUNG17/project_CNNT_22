export type DecimalString=string; export type BigintId=string; export type IsoTimestamp=string;
export type Role='ADMIN'|'KEEPER'|'STAFF'|'VIEWER'; export type MovementType='IN'|'OUT';
export interface Data<T>{data:T} export interface Page<T>{data:T[];count:number;pagination:{page:number;limit:number;total:number;totalPages:number}}
export interface PaginationQuery{page?:number;limit?:number} export interface RequestOptions{signal?:AbortSignal}
export interface Identity{user_id:BigintId;username:string;display_name:string;role:Role}
export interface User extends Identity{is_active:boolean;created_at:IsoTimestamp}
export interface Product{product_id:string;product_name:string;base_unit:string;is_active:boolean;created_at:IsoTimestamp}
export interface DatabaseProduct extends Product{updated_at:IsoTimestamp}
export interface ProductUnit{product_unit_id:BigintId;product_id:string;unit_name:string;conversion_factor:number;scan_code:string;is_base_unit:boolean}
export interface DatabaseProductUnit extends ProductUnit{product_name:string;created_at:IsoTimestamp}
export interface ProductDetail extends Product{units:ProductUnit[]}
export interface Inventory{product_id:string;product_name:string;base_unit:string;is_active:boolean;quantity_base:DecimalString;updated_at:IsoTimestamp}
export interface ScanPoint{scan_point_id:string;point_name:string;is_active:boolean}
export interface DatabaseScanPoint extends ScanPoint{created_at:IsoTimestamp}
export interface Movement{transaction_id:string;product_id:string;product_unit_id:BigintId;scan_point_id:string;movement_type:MovementType;quantity_packages:number;conversion_factor_snapshot:number;quantity_base:DecimalString;inventory_after:DecimalString;created_at:IsoTimestamp}
export interface Transaction extends Movement{product_name:string;unit_name:string;point_name:string}
export interface MovementRequest{transaction_id:string;scan_point_id:string;scan_code:string;movement_type:MovementType;quantity_packages:number}
export interface MovementResponse extends Data<Movement>{meta:{result_status:'CREATED'|'DUPLICATE'}}
export interface ProductCreate{product_id:string;product_name:string;base_unit:string;is_active?:boolean} export interface ProductPatch{product_name?:string;base_unit?:string}
export interface UnitCreate{unit_name:string;conversion_factor:number;scan_code:string;is_base_unit?:boolean} export interface UnitPatch{unit_name?:string;conversion_factor?:number;is_base_unit?:boolean}
export interface ScanPointCreate{scan_point_id:string;point_name:string;is_active?:boolean} export interface ScanPointPatch{point_name?:string;is_active?:boolean}
export interface UserCreate{username:string;display_name:string;role:Role;password:string;is_active?:boolean} export interface UserPatch{username?:string;display_name?:string;role?:Role}
export interface ProductQuery extends PaginationQuery{q?:string} export interface LowStockQuery extends PaginationQuery{threshold?:DecimalString;q?:string}
export interface TransactionQuery extends PaginationQuery{productId?:string;movementType?:MovementType;scanPointId?:string} export interface UserQuery extends PaginationQuery{q?:string;role?:Role;isActive?:boolean}
export interface DateRangeQuery{from?:string;to?:string} export interface TrendQuery extends PaginationQuery,DateRangeQuery{granularity?:'day'|'month';productId?:string;movementType?:MovementType;scanPointId?:string}
export type TopProductsQuery=PaginationQuery&DateRangeQuery&{productId?:string;movementType?:MovementType;scanPointId?:string;q?:string;sortBy?:'transactions'|'inQuantity'|'outQuantity';baseUnit?:string};
export interface Trend{period_start:IsoTimestamp;in_count:DecimalString;out_count:DecimalString;total_count:DecimalString}
export interface TopProduct{product_id:string;product_name:string;base_unit:string;transaction_count:DecimalString;in_count:DecimalString;out_count:DecimalString;quantity_in_base:DecimalString;quantity_out_base:DecimalString}
export interface Summary{products:{total:DecimalString;active:DecimalString;inactive:DecimalString;missing_inventory:DecimalString};inventory_totals:Array<{base_unit:string;quantity_base:DecimalString}>;transactions:{IN:DecimalString;OUT:DecimalString;total:DecimalString};low_stock:{threshold:DecimalString;product_count:DecimalString}}
export class ApiError extends Error{constructor(readonly status:number,readonly code:string,message:string,readonly retryAfter?:number){super(message);this.name='ApiError';}}
