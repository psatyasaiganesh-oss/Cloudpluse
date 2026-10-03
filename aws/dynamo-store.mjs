import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, DeleteItemCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';

export function dynamoStore(tableName, client = new DynamoDBClient({})) {
  const key=(kind,id)=>({pk:{S:kind},sk:{S:id}});
  const conditional=e=>e?.name==='ConditionalCheckFailedException';
  return {
    async get(kind,id) {const r=await client.send(new GetItemCommand({TableName:tableName,Key:key(kind,id),ConsistentRead:true}));return r.Item?JSON.parse(r.Item.data.S):null;},
    async list(kind,limit=300) {
      const rows=[];let cursor;
      do {const r=await client.send(new QueryCommand({TableName:tableName,KeyConditionExpression:'pk = :k',ExpressionAttributeValues:{':k':{S:kind}},ConsistentRead:true,Limit:limit-rows.length,ExclusiveStartKey:cursor}));rows.push(...(r.Items??[]).map(x=>JSON.parse(x.data.S)));cursor=r.LastEvaluatedKey;} while(cursor&&rows.length<limit);
      return rows;
    },
    async put(kind,id,value,expiresAt=0) {await client.send(new PutItemCommand({TableName:tableName,Item:{...key(kind,id),data:{S:JSON.stringify(value)},expires_at:{N:String(expiresAt)}}}));},
    async insert(kind,id,value,expiresAt=0) {try {await client.send(new PutItemCommand({TableName:tableName,Item:{...key(kind,id),data:{S:JSON.stringify(value)},expires_at:{N:String(expiresAt)}},ConditionExpression:'attribute_not_exists(pk)'}));return true;}catch(e){if(conditional(e))return false;throw e;}},
    async acquireLease(id,owner,seconds) {const now=Math.floor(Date.now()/1000);try {await client.send(new PutItemCommand({TableName:tableName,Item:{...key('lease',id),data:{S:JSON.stringify(owner)},expires_at:{N:String(now+seconds)}},ConditionExpression:'attribute_not_exists(pk) OR expires_at < :now',ExpressionAttributeValues:{':now':{N:String(now)}}}));return true;}catch(e){if(conditional(e))return false;throw e;}},
    async releaseLease(id,owner) {try {await client.send(new DeleteItemCommand({TableName:tableName,Key:key('lease',id),ConditionExpression:'#d = :owner',ExpressionAttributeNames:{'#d':'data'},ExpressionAttributeValues:{':owner':{S:JSON.stringify(owner)}}}));}catch(e){if(!conditional(e))throw e;}},
    async ping() {const r=await client.send(new DescribeTableCommand({TableName:tableName}));if(r.Table?.TableStatus!=='ACTIVE')throw new Error('Table not ready');},
  };
}
