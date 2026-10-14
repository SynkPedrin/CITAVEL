import test from 'node:test';import assert from 'node:assert/strict';import { hashToken,newToken,secretMatches,permitsClient,assertMutation,secureCookie } from '../lib/security';
test('session token is random and hashed deterministically',()=>{const token=newToken();assert.ok(token.length>30);assert.notEqual(hashToken(token),token);assert.equal(secretMatches('abc','abc'),true);assert.equal(secretMatches('abc','abd'),false)});
test('client actor cannot cross tenant or assigned client',()=>{const actor:any={organizationId:'org-a',role:'CLIENT_VIEWER',clientIds:['client-a']};assert.equal(permitsClient(actor,{id:'client-a',organizationId:'org-a'}),true);assert.equal(permitsClient(actor,{id:'client-b',organizationId:'org-a'}),false);assert.equal(permitsClient(actor,{id:'client-a',organizationId:'org-b'}),false)});
test('local host aliases keep mutation protection intact',()=>{const request=new Request('http://127.0.0.1:3002/api/auth/login',{method:'POST',headers:{origin:'http://127.0.0.1:3002','x-citavel-request':'1','sec-fetch-site':'same-site'}});assert.doesNotThrow(()=>assertMutation(request,'http://localhost:3002'));const external=new Request('http://localhost:3002/api/auth/login',{method:'POST',headers:{origin:'https://attacker.example','x-citavel-request':'1'}});assert.throws(()=>assertMutation(external,'http://localhost:3002'));});
test('local production cookies require an explicit loopback allowance', () => {
  const before = { NODE_ENV: process.env.NODE_ENV, APP_URL: process.env.APP_URL, ALLOW_INSECURE_LOCAL_HTTP: process.env.ALLOW_INSECURE_LOCAL_HTTP };
  try {
    Object.assign(process.env, { NODE_ENV: 'production', APP_URL: 'http://localhost:3002' });
    delete process.env.ALLOW_INSECURE_LOCAL_HTTP;
    assert.throws(() => secureCookie(), /HTTPS/);
    process.env.ALLOW_INSECURE_LOCAL_HTTP = 'true';
    assert.equal(secureCookie(), false);
    process.env.APP_URL = 'http://citavel.example';
    assert.throws(() => secureCookie(), /HTTPS/);
    process.env.APP_URL = 'https://citavel.example';
    assert.equal(secureCookie(), true);
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
