import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from ftplib import error_perm

spec = importlib.util.spec_from_file_location('deploy_ftp', Path(__file__).with_name('deploy_ftp.py'))
deploy_ftp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy_ftp)

class FakeFTP:
    def __init__(self, exists):
        self.exists = exists
        self.commands = []
        self.destination_missing = False
    def connect(self, *args, **kwargs): pass
    def login(self, *args): pass
    def set_pasv(self, *args): pass
    def voidcmd(self, command): self.commands.append(command)
    def cwd(self, path):
        self.commands.append(('CWD', path))
        if not self.exists: raise error_perm('550 missing')
    def pwd(self): return '/site/ebp'
    def mkd(self, path): self.commands.append(('MKD', path))
    def storbinary(self, command, data): self.commands.append(('STOR', command))
    def delete(self, path): self.commands.append(('DELE', path))
    def rmd(self, path): self.commands.append(('RMD', path))
    def quit(self): pass
    def close(self): pass

class DeploymentContracts(unittest.TestCase):
    def test_unsafe_destinations_are_rejected_before_connect(self):
        for destination in ['/', '/site', '/site/..', '/site/ebp/../..', '/site/./ebp', '/site/ebp\r\nDELE other']:
            with self.subTest(destination=destination), self.assertRaises(SystemExit):
                deploy_ftp.require_remote_dir(destination)
        self.assertEqual(deploy_ftp.require_remote_dir('/site//ebp/'), '/site/ebp')
    def test_preview_never_mutates_existing_or_missing_destination(self):
        for exists in [False, True]:
            ftp = FakeFTP(exists)
            with tempfile.TemporaryDirectory() as temporary:
                site = Path(temporary)
                (site / 'subdir').mkdir()
                (site / 'subdir' / 'index.html').write_text('test')
                env = {'FTP_HOST':'ftp.example.test','FTP_USER':'user','FTP_PASSWORD':'password','FTP_REMOTE_DIR':'/site/ebp'}
                with patch.dict(deploy_ftp.os.environ,env), patch.object(deploy_ftp,'SITE',site), patch.object(deploy_ftp,'FTP',return_value=ftp), patch.object(deploy_ftp,'remote_tree',return_value=({'extra.txt':1},{'old'})):
                    deploy_ftp.deploy(dry_run=True,force=True)
                self.assertFalse(any(isinstance(command,tuple) and command[0] in {'MKD','STOR','DELE','RMD'} for command in ftp.commands), ftp.commands)

if __name__ == '__main__': unittest.main()
