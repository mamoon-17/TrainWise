USE master;
GO

IF EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'ma')
    DROP LOGIN ma;
GO

CREATE LOGIN ma WITH PASSWORD = '123456', CHECK_POLICY = OFF;
GO

USE Project;
GO

IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'ma')
    DROP USER ma;
GO

CREATE USER ma FOR LOGIN ma;
GO

ALTER ROLE db_owner ADD MEMBER ma;
GO