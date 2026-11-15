import { expect } from 'chai'
import fs from 'fs'
import os from 'os'
import path from 'path'
import AdmZip from 'adm-zip'
import { Buffer } from 'buffer'
import { emitDirectory, verify } from '../src/tlc'
import { freeServerEndpoint } from '../src/compileToTlaplus'

describe('emitDirectory', () => {
  it('writes a constrained wrapper and the Apalache modules', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quint-emit-test-'))
    try {
      const lib = path.join(root, 'apalache.jar')
      const out = path.join(root, 'out')
      const jar = new AdmZip()
      for (const name of ['Apalache', 'Variants', 'Option'])
        jar.addFile(`tla2sany/StandardModules/${name}.tla`, Buffer.from(name))
      jar.writeZip(lib)
      emitDirectory(
        { tlaCode: 'compiled', moduleName: 'Model', hasInvariant: true, hasTemporal: true, constraint: 'now <= 6' },
        out,
        lib
      )
      expect(fs.readFileSync(path.join(out, 'Model.tla'), 'utf8')).to.equal('compiled')
      expect(fs.readFileSync(path.join(out, 'Model_Quint.tla'), 'utf8'))
        .to.contain('EXTENDS Model')
        .and.contain('now <= 6')
      expect(fs.readFileSync(path.join(out, 'Model_Quint.cfg'), 'utf8')).to.equal(
        'INIT q_init\nNEXT q_step\nINVARIANT q_inv\nPROPERTY q_temporalProps\nCONSTRAINT q_constraint\n'
      )
      expect(fs.readFileSync(path.join(out, 'Option.tla'), 'utf8')).to.equal('Option')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('checker handoff', () => {
  it('allocates distinct free endpoints', async () => {
    const endpoints = await Promise.all([freeServerEndpoint(), freeServerEndpoint()])
    expect(endpoints[0].port).not.to.equal(endpoints[1].port)
  })

  it('uses tlx and maps its violation exit code', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quint-check-test-'))
    const oldPath = process.env.PATH
    const oldHome = process.env.QUINT_HOME
    try {
      process.env.QUINT_HOME = root
      process.env.PATH = `${root}:${oldPath}`
      const lib = path.join(root, 'apalache-dist-test', 'apalache', 'lib')
      fs.mkdirSync(lib, { recursive: true })
      const jar = new AdmZip()
      for (const name of ['Apalache', 'Variants', 'Option'])
        jar.addFile(`tla2sany/StandardModules/${name}.tla`, Buffer.from(name))
      jar.writeZip(path.join(lib, 'apalache.jar'))
      fs.writeFileSync(path.join(root, 'tlx'), '#!/bin/sh\nexit 12\n', { mode: 0o755 })
      const result = await verify(
        { tlaCode: 'compiled', moduleName: 'Model', hasInvariant: true, hasTemporal: false },
        'test',
        {},
        0,
        'tlx'
      )
      expect(result.isLeft()).to.be.true
      if (result.isLeft()) expect(result.value.isViolation).to.be.true
    } finally {
      process.env.PATH = oldPath
      if (oldHome === undefined) delete process.env.QUINT_HOME
      else process.env.QUINT_HOME = oldHome
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
