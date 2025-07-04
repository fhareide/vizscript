sub OnInit()
end sub
sub OnGeometryChanged(geom As Geometry)
	OnInit()
end sub
function GetName() As String
	GetName = "test"
end function
function GetVersion() As Integer
	GetVersion = 1
end function 